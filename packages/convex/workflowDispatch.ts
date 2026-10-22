import {
  type AnalyticsEventItem,
  accountDeletionInstanceId,
  buildWorkflowDispatchSigningPayload,
  cardProcessingInstanceId,
  type DispatchItem,
  type DispatchResult,
  exportInstanceId,
  filesCardKeyPrefix,
  importInstanceId,
  MAX_DISPATCH_DELETE_KEYS,
  MAX_DISPATCH_ITEMS,
  type MaintenanceParams,
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
import { importStagedPartKeys } from "./import/indexItems";
import {
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "./storage/filesWorkerClient";
import {
  getR2KeyPrefix,
  hmacSha256Hex,
  isR2KeyInNamespace,
  sha256Hex,
} from "./storage/r2Keys";
import { reportFromMutation } from "./telemetry/alerts";
import { captureBackendException } from "./telemetry/posthog";

type DispatchKind = Doc<"workflowDispatches">["kind"];
// Analytics rows are removed when claimed, so they are never sent or stale.
type TrackedKind = Exclude<DispatchKind, "analyticsEvent">;

const WORKFLOW_BY_KIND: Record<
  Exclude<TrackedKind, "deleteObjects">,
  WorkflowName
> = {
  accountDeletion: "account-deletion",
  cardProcessing: "card-processing",
  export: "export",
  import: "import",
  maintenance: "maintenance",
};

export const STALE_AFTER_MS: Record<TrackedKind, number> = {
  accountDeletion: 6 * 60 * 60 * 1000,
  cardProcessing: 60 * 60 * 1000,
  deleteObjects: 60 * 60 * 1000,
  export: 2 * 60 * 60 * 1000,
  import: 6 * 60 * 60 * 1000,
  maintenance: 6 * 60 * 60 * 1000,
};

export const DISPATCH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_DISPATCH_ATTEMPTS = 20;
// Keys a deletion gave up on are queued again this much later, so a Worker
// outage longer than the retries delays a deletion instead of leaking it.
export const DEAD_LETTER_RETRY_MS = 24 * 60 * 60 * 1000;
const FLUSH_BATCH = MAX_DISPATCH_ITEMS;

// A due row nobody has claimed yet means a flush is on its way, and it will
// claim a new row too. A row that has waited longer than this means it isn't.
const FLUSH_STALL_MS = 30_000;

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

/**
 * True when a flush already scheduled will claim a row queued now. Reading
 * the due range also makes two saves racing to be first conflict, so exactly
 * one of them schedules the flush.
 */
const flushIsComing = async (ctx: MutationCtx, now: number) =>
  flushScheduled.has(ctx.db) ||
  (
    await ctx.db
      .query("workflowDispatches")
      .withIndex("by_state_and_notBefore", (q) =>
        q
          .eq("state", "pending")
          .gte("notBefore", now - FLUSH_STALL_MS)
          .lte("notBefore", now)
      )
      .take(1)
  ).length > 0;

const insertDispatch = async (
  ctx: MutationCtx,
  row: Omit<
    Doc<"workflowDispatches">,
    "_creationTime" | "_id" | "createdAt" | "notBefore" | "state"
  > & { delayMs?: number }
): Promise<Id<"workflowDispatches">> => {
  const { delayMs = 0, ...fields } = row;
  const now = Date.now();
  const coalesced = delayMs === 0 && (await flushIsComing(ctx, now));
  const id = await ctx.db.insert("workflowDispatches", {
    ...fields,
    createdAt: now,
    notBefore: now + delayMs,
    state: "pending",
  });
  if (coalesced) {
    flushScheduled.add(ctx.db);
  } else {
    await scheduleFlush(ctx, delayMs);
  }
  return id;
};

const pendingRunToTakeOver = async (
  ctx: MutationCtx,
  card: Doc<"cards">
): Promise<Doc<"workflowDispatches"> | null> => {
  const currentRev = card.processingRev;
  if (!currentRev) {
    return null;
  }
  const currentRun = await ctx.db
    .query("workflowDispatches")
    .withIndex("by_instanceId", (q) =>
      q.eq("instanceId", cardProcessingInstanceId(card._id, currentRev))
    )
    .first();
  return currentRun?.state === "pending" ? currentRun : null;
};

export const queueCardProcessing = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  options: {
    delayMs?: number;
    metadataOnly?: boolean;
    refresh?: boolean;
    reset?: boolean;
  } = {}
): Promise<{ instanceId: string; rev: number } | null> => {
  const card = await ctx.db.get("cards", cardId);
  if (!card) {
    return null;
  }
  const replaced = await pendingRunToTakeOver(ctx, card);
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

/** Starts a Files Worker maintenance task that reports back when it ends. */
export const queueMaintenanceWorkflow = async (
  ctx: MutationCtx,
  instanceId: string,
  params: Omit<MaintenanceParams, "dispatched">
): Promise<string> => {
  await insertDispatch(ctx, {
    instanceId,
    key: `maintenance:${params.task}`,
    kind: "maintenance",
    params: { ...params, dispatched: true },
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

/**
 * Queues one backend analytics event for the Files Worker to send to
 * PostHog. Its flush is the one this transaction already scheduled, if any,
 * so an event costs no function call of its own.
 */
export const queueAnalyticsEvent = async (
  ctx: MutationCtx,
  event: Omit<AnalyticsEventItem, "type">
): Promise<void> => {
  await insertDispatch(ctx, {
    key: "analytics",
    kind: "analyticsEvent",
    params: event,
  });
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

export const claim = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.object({ id: v.id("workflowDispatches"), item: v.any() })),
  handler: async (ctx, { limit }): Promise<ClaimedItem[]> => {
    const now = Date.now();
    const pageSize = Math.min(limit ?? FLUSH_BATCH, FLUSH_BATCH);
    const rows = await ctx.db
      .query("workflowDispatches")
      .withIndex("by_state_and_notBefore", (q) =>
        q.eq("state", "pending").lte("notBefore", now)
      )
      .take(pageSize);
    const claimed: ClaimedItem[] = [];
    for (const row of rows) {
      if (row.kind === "analyticsEvent") {
        // Best effort, like an event an action sends itself: the row goes
        // when it is handed over, so delivery needs no second write.
        await ctx.db.delete("workflowDispatches", row._id);
        claimed.push({
          id: row._id,
          item: {
            ...(row.params as Omit<AnalyticsEventItem, "type">),
            type: "analytics-event",
          },
        });
        continue;
      }
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
        lastReconciledAt: undefined,
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
    // A full page of superseded runs hands nothing over, which ends the
    // flush, so the rows behind it need one of their own.
    if (claimed.length === 0 && rows.length === pageSize) {
      await ctx.scheduler.runAfter(0, internal.workflowDispatch.flush, {});
    }
    return claimed;
  },
});

const retryDelayMs = (attempts: number) =>
  Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempts - 1));

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
        await reportFromMutation(ctx, "workflow_dispatch_dead_lettered", {
          attempts,
          error: error.slice(0, 200),
          kind: row.kind,
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

const DISPATCH_PROOF_TTL_SECONDS = 120;

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

export const flush = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // Convex sets CONVEX_SITE_URL for every deployment; workflows call it back.
    const convexSiteUrl = normalizeConvexSiteUrl(env.CONVEX_SITE_URL);
    const secret = env.WORKFLOW_RPC_SECRET;
    if (!(isFilesWorkerConfigured() && convexSiteUrl && secret)) {
      const waiting: boolean = await ctx.runQuery(
        internal.workflowDispatch.hasPending,
        {}
      );
      if (waiting) {
        await captureBackendException(
          new Error("workflow_dispatch_not_configured"),
          {
            properties: {
              convex_site_url: Boolean(convexSiteUrl),
              files_worker: isFilesWorkerConfigured(),
              rpc_secret: Boolean(secret),
            },
          }
        );
      }
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
      // Claiming removed the analytics rows, so only the rest can be retried.
      const retryable = (accepted?: Set<number>) =>
        claimed
          .filter(
            ({ item }, index) =>
              item.type !== "analytics-event" && !accepted?.has(index)
          )
          .map(({ id }) => id);
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
        if (outcome.kind === "declined") {
          failedIds = retryable();
          error = outcome.code;
        } else {
          const accepted = new Set(
            outcome.data.results
              .filter((result) => result.ok)
              .map((result) => result.index)
          );
          failedIds = retryable(accepted);
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
        failedIds = retryable();
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
    }
    await ctx.scheduler.runAfter(0, internal.workflowDispatch.flush, {});
    return null;
  },
});

export const hasPending = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) =>
    (await ctx.db
      .query("workflowDispatches")
      .withIndex("by_state_and_notBefore", (q) => q.eq("state", "pending"))
      .first()) !== null,
});

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
          await enqueueObjectDeletion(
            ctx,
            importStagedPartKeys(
              filesCardKeyPrefix(getR2KeyPrefix(), job.userId),
              jobId,
              job.stagedItems
            )
          );
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
        await queueAccountDeletionWorkflow(
          ctx,
          { generation: state.generation, stateId },
          { delayMs: 5 * 60 * 1000 }
        );
      }
      return;
    }
    case "deleteObjects": {
      await insertDispatch(ctx, {
        delayMs: DEAD_LETTER_RETRY_MS,
        key: "deleteObjects",
        keys: row.keys ?? [],
        kind: "deleteObjects",
      });
      return;
    }
    default:
      return;
  }
};

export const INSTANCE_MISSING = "instance_missing";

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

const STALE_SCAN_BUDGET = 1000;

const isStale = (row: Doc<"workflowDispatches">, now: number) =>
  row.kind !== "deleteObjects" &&
  row.kind !== "analyticsEvent" &&
  row.instanceId !== undefined &&
  (row.sentAt ?? now) < now - STALE_AFTER_MS[row.kind];

/**
 * Sent runs past their kind's silence limit, for the Files Worker's reconcile
 * to look up: first the ones it never checked, oldest send first, then the
 * ones it checked longest ago (`markReconciled`). Runs still going in
 * Cloudflare so move to the back instead of hiding newer stale ones.
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
    const pageSize = Math.min(limit ?? 100, 200);
    const stale: Doc<"workflowDispatches">[] = [];
    let scanned = 0;
    const collect = async (
      rows: AsyncIterable<Doc<"workflowDispatches">>
    ): Promise<void> => {
      for await (const row of rows) {
        if (stale.length >= pageSize || scanned >= STALE_SCAN_BUDGET) {
          return;
        }
        scanned += 1;
        if (isStale(row, now)) {
          stale.push(row);
        }
      }
    };
    await collect(
      ctx.db
        .query("workflowDispatches")
        .withIndex("by_state_and_lastReconciledAt_and_sentAt", (q) =>
          q
            .eq("state", "sent")
            .eq("lastReconciledAt", undefined)
            .lt("sentAt", now - shortest)
        )
    );
    await collect(
      ctx.db
        .query("workflowDispatches")
        .withIndex("by_state_and_lastReconciledAt_and_sentAt", (q) =>
          q.eq("state", "sent").gte("lastReconciledAt", 0)
        )
    );
    return stale.flatMap((row) =>
      row.kind !== "deleteObjects" &&
      row.kind !== "analyticsEvent" &&
      row.instanceId
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

/** Records the runs the reconcile looked up and found still going. */
export const markReconciled = internalMutation({
  args: { instanceIds: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { instanceIds }) => {
    const now = Date.now();
    for (const instanceId of instanceIds.slice(0, 200)) {
      const rows = await ctx.db
        .query("workflowDispatches")
        .withIndex("by_instanceId", (q) => q.eq("instanceId", instanceId))
        .take(10);
      for (const row of rows) {
        if (row.state === "sent") {
          await ctx.db.patch("workflowDispatches", row._id, {
            lastReconciledAt: now,
          });
        }
      }
    }
    return null;
  },
});

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
