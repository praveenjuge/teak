import {
  accountDeletionInstanceId,
  buildWorkflowDispatchSigningPayload,
  cardProcessingInstanceId,
  type DispatchItem,
  type DispatchResult,
  exportInstanceId,
  importInstanceId,
  MAX_DISPATCH_DELETE_KEYS,
  MAX_DISPATCH_ITEMS,
  normalizeConvexSiteUrl,
  type WorkflowName,
} from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import {
  CARD_PROCESSING_STAGES,
  initializeCardProcessingState,
  markUnfinishedCardStagesFailed,
} from "./card/processingLifecycle";
import {
  ACTIVE_EXPORT_STATUSES,
  EXPORT_FAILURE_CLASS,
} from "./export/constants";
import { ACTIVE_IMPORT_STATUSES } from "./import/constants";
import {
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "./storage/filesWorkerClient";
import { hmacSha256Hex, isR2KeyInNamespace, sha256Hex } from "./storage/r2Keys";

// Background work runs on Cloudflare Workflows and Queues in the Files
// Worker. Mutations record it here, in the same transaction as the change
// that needs it, and `flush` hands it over with the `dispatch` op. Workflow
// instance IDs are deterministic, so sending a row twice is harmless.

type DispatchKind = Doc<"workflowDispatches">["kind"];

const WORKFLOW_BY_KIND: Record<
  Exclude<DispatchKind, "deleteObjects">,
  WorkflowName
> = {
  accountDeletion: "account-deletion",
  cardProcessing: "card-processing",
  export: "export",
  import: "import",
  maintenance: "maintenance",
};

/** How long a sent run may go without reporting before reconcile checks it. */
export const STALE_AFTER_MS: Record<DispatchKind, number> = {
  accountDeletion: 6 * 60 * 60 * 1000,
  cardProcessing: 60 * 60 * 1000,
  deleteObjects: 60 * 60 * 1000,
  export: 2 * 60 * 60 * 1000,
  import: 6 * 60 * 60 * 1000,
  maintenance: 6 * 60 * 60 * 1000,
};

/** Finished rows are kept this long for investigation, then deleted. */
export const DISPATCH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** A row that could not be handed over this many times is given up. */
export const MAX_DISPATCH_ATTEMPTS = 20;
const FLUSH_BATCH = MAX_DISPATCH_ITEMS;

// One flush per transaction is enough: it hands over every pending row.
const flushScheduled = new WeakSet<object>();

const scheduleFlush = async (ctx: MutationCtx, delayMs = 0) => {
  if (delayMs === 0 && flushScheduled.has(ctx.db)) {
    return;
  }
  if (delayMs === 0) {
    flushScheduled.add(ctx.db);
  }
  await ctx.scheduler.runAfter(delayMs, internal.workflowDispatch.flush, {});
};

const insertDispatch = async (
  ctx: MutationCtx,
  row: Omit<
    Doc<"workflowDispatches">,
    "_creationTime" | "_id" | "createdAt" | "notBefore" | "state"
  > & { delayMs?: number }
): Promise<Id<"workflowDispatches">> => {
  const { delayMs = 0, ...fields } = row;
  const now = Date.now();
  const id = await ctx.db.insert("workflowDispatches", {
    ...fields,
    createdAt: now,
    notBefore: now + delayMs,
    state: "pending",
  });
  await scheduleFlush(ctx, delayMs);
  return id;
};

/**
 * Starts a card-processing run: bumps the card's processing revision, so
 * any earlier run stops writing, and queues the run for that revision.
 * With `reset`, the card's AI output and stages are cleared when the run
 * is sent (after `delayMs`), not now. With `metadataOnly`, the run only
 * regenerates the AI metadata (the admin's AI backfill retry).
 */
export const queueCardProcessing = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  options: {
    delayMs?: number;
    metadataOnly?: boolean;
    /** "Refresh details": read the link preview and category again. */
    refresh?: boolean;
    reset?: boolean;
  } = {}
): Promise<{ instanceId: string; rev: number } | null> => {
  const card = await ctx.db.get("cards", cardId);
  if (!card) {
    return null;
  }
  // The run for the current revision, if it is still waiting to be sent, is
  // replaced by this one, which takes over what it owed: its reset, and the
  // whole pipeline. Each run takes over from the one before, so the
  // previous revision is the only one to look at.
  const previous = card.processingRev
    ? await ctx.db
        .query("workflowDispatches")
        .withIndex("by_instanceId", (q) =>
          q.eq(
            "instanceId",
            cardProcessingInstanceId(cardId, card.processingRev ?? 0)
          )
        )
        .first()
    : null;
  const replaced = previous?.state === "pending" ? previous : null;
  const reset = options.reset === true || replaced?.reset === true;
  const refresh =
    options.refresh === true || replaced?.params?.refresh === true;
  const metadataOnly =
    !refresh &&
    options.metadataOnly === true &&
    (!replaced || replaced.params?.metadataOnly === true);
  const rev = (card.processingRev ?? 0) + 1;
  await ctx.db.patch("cards", cardId, { processingRev: rev });
  const instanceId = cardProcessingInstanceId(cardId, rev);
  await insertDispatch(ctx, {
    cardId,
    delayMs: options.delayMs,
    instanceId,
    key: `card:${cardId}`,
    kind: "cardProcessing",
    params: {
      cardId,
      rev,
      ...(metadataOnly ? { metadataOnly: true } : {}),
      ...(refresh ? { refresh: true } : {}),
    },
    rev,
    ...(reset ? { reset: true as const } : {}),
  });
  return { instanceId, rev };
};

export const queueExportWorkflow = async (
  ctx: MutationCtx,
  jobId: Id<"exportJobs">,
  userId: string
): Promise<string> => {
  const instanceId = exportInstanceId(jobId);
  await insertDispatch(ctx, {
    instanceId,
    key: `export:${jobId}`,
    kind: "export",
    params: { jobId, userId },
  });
  return instanceId;
};

export const queueImportWorkflow = async (
  ctx: MutationCtx,
  jobId: Id<"importJobs">
): Promise<string> => {
  const instanceId = importInstanceId(jobId);
  await insertDispatch(ctx, {
    instanceId,
    key: `import:${jobId}`,
    kind: "import",
    params: { jobId },
  });
  return instanceId;
};

/**
 * Each failed run is started again as a new attempt. Attempts are numbered
 * by when they were queued, not by counting earlier rows: those are pruned
 * after a week while Cloudflare keeps instances longer, and a reused ID
 * would never start.
 */
export const queueAccountDeletionWorkflow = async (
  ctx: MutationCtx,
  binding: { generation: number; stateId: Id<"accountDeletionStates"> },
  options: { delayMs?: number } = {}
): Promise<string> => {
  const key = `accountDeletion:${binding.stateId}:${binding.generation}`;
  const latest = await ctx.db
    .query("workflowDispatches")
    .withIndex("by_key_and_createdAt", (q) => q.eq("key", key))
    .order("desc")
    .first();
  const instanceId = accountDeletionInstanceId(
    binding.stateId,
    binding.generation,
    Math.max(Date.now(), (latest?.createdAt ?? 0) + 1)
  );
  await insertDispatch(ctx, {
    delayMs: options.delayMs,
    instanceId,
    key,
    kind: "accountDeletion",
    params: binding,
  });
  return instanceId;
};

/** Queues storage objects for deletion, in batches the Worker accepts. */
export const enqueueObjectDeletion = async (
  ctx: MutationCtx,
  keys: readonly string[]
): Promise<number> => {
  const usable = [
    ...new Set(keys.filter((key) => key && isR2KeyInNamespace(key))),
  ];
  for (let i = 0; i < usable.length; i += MAX_DISPATCH_DELETE_KEYS) {
    await insertDispatch(ctx, {
      key: "deleteObjects",
      keys: usable.slice(i, i + MAX_DISPATCH_DELETE_KEYS),
      kind: "deleteObjects",
    });
  }
  return usable.length;
};

const previousSentInstances = async (
  ctx: MutationCtx,
  row: Doc<"workflowDispatches">
): Promise<string[]> => {
  const earlier = await ctx.db
    .query("workflowDispatches")
    .withIndex("by_key_and_createdAt", (q) =>
      q.eq("key", row.key).lt("createdAt", row.createdAt + 1)
    )
    .order("desc")
    .take(20);
  return earlier
    .filter(
      (other) =>
        other._id !== row._id &&
        other.state === "sent" &&
        other.instanceId !== undefined
    )
    .map((other) => other.instanceId as string);
};

interface ClaimedItem {
  id: Id<"workflowDispatches">;
  item: DispatchItem;
}

/**
 * Takes the pending rows that are due and marks them sent. A card run
 * whose revision was replaced before it was sent is dropped instead.
 */
export const claim = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.object({ id: v.id("workflowDispatches"), item: v.any() })),
  handler: async (ctx, { limit }): Promise<ClaimedItem[]> => {
    const now = Date.now();
    const rows = await ctx.db
      .query("workflowDispatches")
      .withIndex("by_state_and_notBefore", (q) =>
        q.eq("state", "pending").lte("notBefore", now)
      )
      .take(Math.min(limit ?? FLUSH_BATCH, FLUSH_BATCH));
    const claimed: ClaimedItem[] = [];
    for (const row of rows) {
      if (row.kind === "deleteObjects") {
        await ctx.db.patch("workflowDispatches", row._id, {
          attempts: (row.attempts ?? 0) + 1,
          sentAt: now,
          state: "sent",
        });
        claimed.push({
          id: row._id,
          item: { keys: row.keys ?? [], type: "delete-objects" },
        });
        continue;
      }
      if (row.kind === "cardProcessing" && row.cardId) {
        const card = await ctx.db.get("cards", row.cardId);
        if (!card || (card.processingRev ?? 0) !== row.rev) {
          await ctx.db.patch("workflowDispatches", row._id, {
            error: card ? "superseded" : "card_missing",
            finishedAt: now,
            state: "done",
          });
          continue;
        }
        if (row.reset) {
          await initializeCardProcessingState(ctx, row.cardId, {
            refresh: row.params?.refresh === true,
          });
        }
      }
      const terminate =
        row.kind === "cardProcessing"
          ? await previousSentInstances(ctx, row)
          : [];
      await ctx.db.patch("workflowDispatches", row._id, {
        attempts: (row.attempts ?? 0) + 1,
        // The reset is applied once: sending the row again after a lost
        // reply must not wipe what the run has written since.
        ...(row.reset ? { reset: undefined } : {}),
        sentAt: now,
        state: "sent",
      });
      claimed.push({
        id: row._id,
        item: {
          id: row.instanceId as string,
          params: row.params ?? {},
          ...(terminate.length > 0 ? { terminate } : {}),
          type: "workflow",
          workflow: WORKFLOW_BY_KIND[row.kind],
        },
      });
    }
    return claimed;
  },
});

const retryDelayMs = (attempts: number) =>
  Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempts - 1));

/** Rows the Worker did not accept go back to pending, with a delay. */
export const release = internalMutation({
  args: {
    error: v.string(),
    ids: v.array(v.id("workflowDispatches")),
  },
  returns: v.null(),
  handler: async (ctx, { error, ids }) => {
    const now = Date.now();
    let earliest: number | null = null;
    for (const id of ids) {
      const row = await ctx.db.get("workflowDispatches", id);
      if (row?.state !== "sent") {
        continue;
      }
      const attempts = row.attempts ?? 1;
      if (attempts >= MAX_DISPATCH_ATTEMPTS) {
        await ctx.db.patch("workflowDispatches", id, {
          error: `dispatch_failed:${error}`.slice(0, 300),
          finishedAt: now,
          state: "failed",
        });
        await handleRunFailure(ctx, row, "dispatch_failed");
        continue;
      }
      const notBefore = now + retryDelayMs(attempts);
      await ctx.db.patch("workflowDispatches", id, {
        error: error.slice(0, 300),
        notBefore,
        state: "pending",
      });
      earliest = earliest === null ? notBefore : Math.min(earliest, notBefore);
    }
    if (earliest !== null) {
      await scheduleFlush(ctx, earliest - now);
    }
    return null;
  },
});

/** A dispatch proof stays valid this long. */
const DISPATCH_PROOF_TTL_SECONDS = 120;

/**
 * Proves to the Worker that this deployment sent the items, so it only
 * starts runs that report back here.
 */
export const signDispatch = async (
  secret: string,
  convexSiteUrl: string,
  items: DispatchItem[],
  now = Date.now()
): Promise<{ expiresAt: string; signature: string }> => {
  const expiresAt = String(Math.floor(now / 1000) + DISPATCH_PROOF_TTL_SECONDS);
  const signature = await hmacSha256Hex(
    secret,
    buildWorkflowDispatchSigningPayload({
      convexSiteUrl,
      expiresAt,
      itemsSha256: await sha256Hex(JSON.stringify(items)),
    })
  );
  return { expiresAt, signature };
};

/**
 * Hands every due row to the Files Worker. Without a Worker (the local E2E
 * stack), rows stay pending until one is configured.
 */
export const flush = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // Convex sets CONVEX_SITE_URL for every deployment; workflows call it back.
    const convexSiteUrl = normalizeConvexSiteUrl(env.CONVEX_SITE_URL);
    const secret = env.WORKFLOW_RPC_SECRET;
    if (!(isFilesWorkerConfigured() && convexSiteUrl && secret)) {
      return null;
    }
    for (let round = 0; round < 10; round += 1) {
      const claimed: ClaimedItem[] = await ctx.runMutation(
        internal.workflowDispatch.claim,
        { limit: FLUSH_BATCH }
      );
      if (claimed.length === 0) {
        return null;
      }
      let failedIds: Id<"workflowDispatches">[] = [];
      let deliveredIds: Id<"workflowDispatches">[] = [];
      let error = "dispatch_rejected";
      try {
        const items = claimed.map(({ item }) => item);
        const outcome = await callFilesWorkerJson<DispatchResult>({
          op: "dispatch",
          params: {
            convexSiteUrl,
            items,
            ...(await signDispatch(secret, convexSiteUrl, items)),
          },
          timeoutMs: 60_000,
        });
        if (outcome.kind === "fallback") {
          failedIds = claimed.map(({ id }) => id);
          error = outcome.code;
        } else {
          const accepted = new Set(
            outcome.data.results
              .filter((result) => result.ok)
              .map((result) => result.index)
          );
          failedIds = claimed
            .filter((_, index) => !accepted.has(index))
            .map(({ id }) => id);
          deliveredIds = claimed
            .filter(
              ({ item }, index) =>
                accepted.has(index) && item.type === "delete-objects"
            )
            .map(({ id }) => id);
          error =
            outcome.data.results.find((result) => !result.ok)?.error ??
            "dispatch_rejected";
        }
      } catch (caught) {
        failedIds = claimed.map(({ id }) => id);
        error = caught instanceof Error ? caught.message : String(caught);
      }
      if (deliveredIds.length > 0) {
        await ctx.runMutation(internal.workflowDispatch.markDelivered, {
          ids: deliveredIds,
        });
      }
      if (failedIds.length > 0) {
        await ctx.runMutation(internal.workflowDispatch.release, {
          error,
          ids: failedIds,
        });
      }
      if (claimed.length < FLUSH_BATCH) {
        return null;
      }
    }
    await ctx.scheduler.runAfter(0, internal.workflowDispatch.flush, {});
    return null;
  },
});

/** Leaves the job a failed run owned in a state the user can see. */
const handleRunFailure = async (
  ctx: MutationCtx,
  row: Doc<"workflowDispatches">,
  error: string
): Promise<void> => {
  const params = (row.params ?? {}) as Record<string, unknown>;
  switch (row.kind) {
    case "cardProcessing": {
      if (!row.cardId) {
        return;
      }
      const card = await ctx.db.get("cards", row.cardId);
      if (!card || (card.processingRev ?? 0) !== row.rev) {
        return;
      }
      await markUnfinishedCardStagesFailed(
        ctx,
        { cardId: row.cardId, stages: CARD_PROCESSING_STAGES },
        error
      );
      return;
    }
    case "export": {
      const jobId = ctx.db.normalizeId("exportJobs", String(params.jobId));
      const job = jobId ? await ctx.db.get("exportJobs", jobId) : null;
      if (
        jobId &&
        job &&
        (ACTIVE_EXPORT_STATUSES as string[]).includes(job.status)
      ) {
        await ctx.runMutation(internal.dataExport.failExport, {
          failureClass: EXPORT_FAILURE_CLASS.UNKNOWN,
          jobId,
        });
      }
      return;
    }
    case "import": {
      const jobId = ctx.db.normalizeId("importJobs", String(params.jobId));
      const job = jobId ? await ctx.db.get("importJobs", jobId) : null;
      if (
        jobId &&
        job &&
        (ACTIVE_IMPORT_STATUSES as readonly string[]).includes(job.status)
      ) {
        try {
          await ctx.runMutation(internal.dataImport.finishJob, {
            failureClass: "import_workflow_failed",
            jobId,
            status: "failed",
          });
        } catch (finishError) {
          console.error("workflow_dispatch.import_finish_failed", {
            error:
              finishError instanceof Error
                ? finishError.message
                : String(finishError),
            jobId,
          });
        }
      }
      return;
    }
    case "accountDeletion": {
      const stateId = ctx.db.normalizeId(
        "accountDeletionStates",
        String(params.stateId)
      );
      const state = stateId
        ? await ctx.db.get("accountDeletionStates", stateId)
        : null;
      if (
        stateId &&
        state &&
        typeof state.generation === "number" &&
        state.generation === params.generation
      ) {
        // Account deletion must finish: start the next attempt.
        await queueAccountDeletionWorkflow(
          ctx,
          { generation: state.generation, stateId },
          { delayMs: 5 * 60 * 1000 }
        );
      }
      return;
    }
    default:
      return;
  }
};

/** Reconcile's error for a sent run Cloudflare has no instance for. */
export const INSTANCE_MISSING = "instance_missing";

/** A workflow reports how it ended (the Worker, or reconcile on its behalf). */
export const complete = internalMutation({
  args: {
    error: v.optional(v.string()),
    instanceId: v.string(),
    status: v.union(v.literal("complete"), v.literal("errored")),
  },
  returns: v.null(),
  handler: async (ctx, { error, instanceId, status }) => {
    const rows = await ctx.db
      .query("workflowDispatches")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", instanceId))
      .take(10);
    const row = rows.find(
      (candidate) => candidate.state === "pending" || candidate.state === "sent"
    );
    if (!row) {
      return null;
    }
    const now = Date.now();
    // Reconcile found no instance: the hand-over was lost after the claim
    // (the flush died before the Worker started it). Instance IDs are
    // deterministic, so sending the row again is safe.
    if (
      error === INSTANCE_MISSING &&
      row.state === "sent" &&
      (row.attempts ?? 1) < MAX_DISPATCH_ATTEMPTS
    ) {
      await ctx.db.patch("workflowDispatches", row._id, {
        error: INSTANCE_MISSING,
        notBefore: now,
        state: "pending",
      });
      await scheduleFlush(ctx);
      return null;
    }
    await ctx.db.patch("workflowDispatches", row._id, {
      finishedAt: now,
      state: status === "complete" ? "done" : "failed",
      ...(error ? { error: error.slice(0, 300) } : {}),
    });
    if (status === "errored") {
      await handleRunFailure(ctx, row, "workflow_failed");
    }
    return null;
  },
});

/**
 * Object deletions the Worker accepted belong to its queue from then on, so
 * their rows are done at once and never crowd the sent rows reconcile pages
 * through.
 */
export const markDelivered = internalMutation({
  args: { ids: v.array(v.id("workflowDispatches")) },
  returns: v.null(),
  handler: async (ctx, { ids }) => {
    const now = Date.now();
    for (const id of ids) {
      const row = await ctx.db.get("workflowDispatches", id);
      if (row?.kind === "deleteObjects" && row.state === "sent") {
        await ctx.db.patch("workflowDispatches", id, {
          finishedAt: now,
          state: "done",
        });
      }
    }
    return null;
  },
});

/**
 * Sent runs that have not reported for longer than their kind allows, for
 * the Worker's hourly reconcile to look up. Object deletions are queued, not
 * workflows: once sent they are the queue's, so they are just marked done.
 */
export const listStale = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      instanceId: v.string(),
      kind: v.string(),
      workflow: v.string(),
    })
  ),
  handler: async (ctx, { limit }) => {
    const now = Date.now();
    const shortest = Math.min(...Object.values(STALE_AFTER_MS));
    const rows = await ctx.db
      .query("workflowDispatches")
      .withIndex("by_state_and_sentAt", (q) =>
        q.eq("state", "sent").lt("sentAt", now - shortest)
      )
      .take(Math.min(limit ?? 100, 200));
    return rows.flatMap((row) =>
      row.kind !== "deleteObjects" &&
      row.instanceId &&
      (row.sentAt ?? now) < now - STALE_AFTER_MS[row.kind]
        ? [
            {
              instanceId: row.instanceId,
              kind: row.kind,
              workflow: WORKFLOW_BY_KIND[row.kind],
            },
          ]
        : []
    );
  },
});

/**
 * Hourly housekeeping from the Worker: reschedules a flush when rows have
 * waited too long (a lost flush), marks done the sent object deletions a
 * flush could not (it died after the hand-over), and deletes finished rows
 * past retention.
 */
export const pruneFinished = internalMutation({
  args: {},
  returns: v.object({
    deleted: v.number(),
    hasMore: v.boolean(),
    stuckPending: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const stuck = await ctx.db
      .query("workflowDispatches")
      .withIndex("by_state_and_notBefore", (q) =>
        q.eq("state", "pending").lt("notBefore", now - 5 * 60 * 1000)
      )
      .take(100);
    if (stuck.length > 0) {
      await scheduleFlush(ctx);
    }
    const sentDeletes = await ctx.db
      .query("workflowDispatches")
      .withIndex("by_state_and_sentAt", (q) =>
        q.eq("state", "sent").lt("sentAt", now - STALE_AFTER_MS.deleteObjects)
      )
      .take(200);
    for (const row of sentDeletes) {
      if (row.kind === "deleteObjects") {
        await ctx.db.patch("workflowDispatches", row._id, {
          finishedAt: now,
          state: "done",
        });
      }
    }
    let deleted = 0;
    let hasMore = false;
    for (const state of ["done", "failed"] as const) {
      const rows = await ctx.db
        .query("workflowDispatches")
        .withIndex("by_state_and_finishedAt", (q) =>
          q.eq("state", state).lt("finishedAt", now - DISPATCH_RETENTION_MS)
        )
        .take(200);
      for (const row of rows) {
        await ctx.db.delete("workflowDispatches", row._id);
      }
      deleted += rows.length;
      hasMore ||= rows.length === 200;
    }
    return { deleted, hasMore, stuckPending: stuck.length };
  },
});
