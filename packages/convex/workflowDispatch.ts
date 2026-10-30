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
  type QueryCtx,
} from "./_generated/server";
import {
  CARD_PROCESSING_STAGES,
  initializeCardProcessingState,
  markUnfinishedCardStagesFailed,
} from "./card/processingLifecycle";
import {
  pendingRunToTakeOver,
  takeSnapshotWaitingAfterRun,
} from "./card/processingRuns";
import {
  ACTIVE_EXPORT_STATUSES,
  EXPORT_FAILURE_CLASS,
} from "./export/constants";
import { ACTIVE_IMPORT_STATUSES } from "./import/constants";
import { importStagedPartKeys } from "./import/indexItems";
import { articleSkipReason } from "./shared/article";
import { pageArchiveSkipReason } from "./shared/pageArchive";
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

// Every save schedules its own flush, so under parallel saves many flushes
// call claim at the same moment and conflict with each other on the due
// range. Convex retries those conflicts internally; the guards below keep
// that cheap: a small jitter spreads claim starts out, claim reads only a
// small page per mutation so conflicting transactions stay short, and a
// flush whose claim still exhausts Convex's retries reschedules itself with
// backoff instead of dying. Rows that somehow stay pending past
// PENDING_STALL_MS are re-armed by the hourly workflowDispatchWatchdog cron,
// so a failed flush never strands work silently.
export const FLUSH_JITTER_MS = 1500;
export const CLAIM_PAGE = 16;
const MAX_CLAIM_RETRY_ATTEMPTS = 8;

export const claimRetryDelayMs = (attempt: number): number | null =>
  attempt >= MAX_CLAIM_RETRY_ATTEMPTS
    ? null
    : Math.min(60_000, 1000 * 2 ** Math.max(0, attempt));

const flushScheduled = new WeakSet<object>();

// crypto.getRandomValues instead of Math.random: static analysis flags
// Math.random as a weak RNG even for scheduling jitter.
const randomBelow = (bound: number): number => {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return (buffer[0] ?? 0) % bound;
};

const scheduleFlush = async (ctx: MutationCtx, delayMs = 0) => {
  if (delayMs === 0 && flushScheduled.has(ctx.db)) {
    return;
  }
  if (delayMs === 0) {
    flushScheduled.add(ctx.db);
  }
  const jitter = delayMs === 0 ? randomBelow(FLUSH_JITTER_MS) : 0;
  await ctx.scheduler.runAfter(
    delayMs + jitter,
    internal.workflowDispatch.flush,
    {}
  );
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
  // Every row schedules its own flush rather than checking whether one is
  // already coming: that check read the due range every concurrent save
  // writes into, so parallel saves conflicted on it until one exhausted its
  // OCC retries and the request failed. Duplicate flushes instead conflict
  // with each other in claim, and the jitter in scheduleFlush, claim's small
  // page and the flush's own claim retry keep those conflicts cheap next to
  // a failed save.
  await scheduleFlush(ctx, delayMs);
  return id;
};

export const queueCardProcessing = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  options: {
    /**
     * Only "load card", "archive page" and the article steps run: a link's
     * saved copy and the article in it.
     */
    archiveOnly?: boolean;
    /** Only "load card" and the article steps run: a link's article. */
    articleOnly?: boolean;
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
  // A run that takes over a whole pending run keeps its work: it narrows to
  // the archive or the article only when the run it replaces did too, and
  // to the article alone only when neither asks for the archive.
  const narrowed = (params?: {
    archiveOnly?: boolean;
    articleOnly?: boolean;
  }) => params?.archiveOnly === true || params?.articleOnly === true;
  const narrow =
    !(reset || metadataOnly) &&
    narrowed(options) &&
    (!replaced || narrowed(replaced.params));
  const archiveOnly =
    narrow &&
    (options.archiveOnly === true || replaced?.params?.archiveOnly === true);
  const articleOnly = narrow && !archiveOnly;
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
      ...(archiveOnly ? { archiveOnly: true } : {}),
      ...(articleOnly ? { articleOnly: true } : {}),
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

/** Starts a Core Worker maintenance task that reports back when it ends. */
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

const ACCOUNT_DELETION_RETRY_BASE_MS = 5 * 60 * 1000;
const ACCOUNT_DELETION_RETRY_MAX_MS = 6 * 60 * 60 * 1000;

/** The wait before the next account deletion attempt after `failures` in a row. */
export const accountDeletionRetryDelayMs = (failures: number): number =>
  Math.min(
    ACCOUNT_DELETION_RETRY_MAX_MS,
    ACCOUNT_DELETION_RETRY_BASE_MS * 2 ** Math.max(0, failures - 1)
  );

/**
 * Failures another attempt can't fix: the storage being deleted changed
 * under the run. An operator resolves it, then runs
 * `accountDeletionJobs:retry`.
 */
export const accountDeletionNeedsOperator = (failureCode?: string): boolean =>
  failureCode?.endsWith("_storage_source_changed") === true;

const consecutiveFailures = async (
  ctx: MutationCtx,
  key: string
): Promise<number> => {
  const recent = await ctx.db
    .query("workflowDispatches")
    .withIndex("by_key_and_createdAt", (q) => q.eq("key", key))
    .order("desc")
    .take(20);
  const firstOther = recent.findIndex((row) => row.state !== "failed");
  return firstOther === -1 ? recent.length : firstOther;
};

const hasNewerLiveAttempt = async (
  ctx: MutationCtx,
  row: Doc<"workflowDispatches">
): Promise<boolean> => {
  const newer = await ctx.db
    .query("workflowDispatches")
    .withIndex("by_key_and_createdAt", (q) =>
      q.eq("key", row.key).gte("createdAt", row.createdAt)
    )
    // Newest first: a live attempt is the latest one queued.
    .order("desc")
    .take(20);
  return newer.some(
    (other) =>
      other._id !== row._id &&
      (other.state === "pending" || other.state === "sent")
  );
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
 * Queues one backend analytics event for the Core Worker to send to
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
  args: { claimRetry: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { claimRetry = 0 }) => {
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
      let claimed: ClaimedItem[];
      try {
        // A small page keeps each claim mutation short: parallel flushes
        // conflict on the same due rows, and short conflicting transactions
        // are what Convex's internal retries recover from reliably.
        claimed = await ctx.runMutation(internal.workflowDispatch.claim, {
          limit: CLAIM_PAGE,
        });
      } catch (caught) {
        // Parallel flushes conflict with each other in claim. Convex retries
        // the mutation, but a claim that still exhausts those retries must
        // not kill the flush: the rows stay pending and would wait for the
        // next save. Back off and re-run instead; after a run of failures,
        // report and stop - the hourly watchdog re-arms a flush once rows
        // pass PENDING_STALL_MS, so stopping here strands nothing.
        const delay = claimRetryDelayMs(claimRetry);
        if (delay === null) {
          await captureBackendException(
            caught instanceof Error ? caught : new Error(String(caught)),
            {
              properties: {
                source: "workflow_dispatch_claim_retry_exhausted",
              },
            }
          );
          return null;
        }
        await ctx.scheduler.runAfter(delay, internal.workflowDispatch.flush, {
          claimRetry: claimRetry + 1,
        });
        return null;
      }
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
      // A link whose run ended before its last step still gets its saved
      // copy, from a run of its own: a page that can't be fetched then fails
      // only that stage. An archive-only run that fails just fails the stage.
      // The same goes for the article in a copy the run didn't reach. A
      // narrowed run that fails just fails its stages.
      const refresh = params.refresh === true;
      const narrowed =
        params.archiveOnly === true || params.articleOnly === true;
      const archiveSeparately =
        !narrowed && pageArchiveSkipReason(card, { refresh }) === null;
      const articleSeparately =
        !(narrowed || archiveSeparately) &&
        articleSkipReason(card, { refresh }) === null;
      await markUnfinishedCardStagesFailed(
        ctx,
        {
          cardId: row.cardId,
          stages: [
            ...CARD_PROCESSING_STAGES,
            ...(archiveSeparately ? [] : (["archive"] as const)),
            ...(archiveSeparately || articleSeparately
              ? []
              : (["article"] as const)),
          ],
        },
        error
      );
      if (archiveSeparately || articleSeparately) {
        await queueCardProcessing(ctx, row.cardId, {
          ...(archiveSeparately
            ? { archiveOnly: true }
            : { articleOnly: true }),
          ...(refresh ? { refresh: true } : {}),
        });
      }
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
        !(
          stateId &&
          state &&
          typeof state.generation === "number" &&
          state.generation === params.generation
        )
      ) {
        return;
      }
      // A newer attempt already queued or running (an operator's `retry`
      // while this one ran) carries the deletion on: another attempt here
      // would leave two runs racing on the same stage for good.
      if (await hasNewerLiveAttempt(ctx, row)) {
        return;
      }
      if (accountDeletionNeedsOperator(state.failureCode)) {
        await reportFromMutation(ctx, "account_deletion_needs_operator", {
          failure_code: state.failureCode ?? "",
          state_id: stateId,
        });
        return;
      }
      const delayMs = accountDeletionRetryDelayMs(
        await consecutiveFailures(ctx, row.key)
      );
      await ctx.db.patch("accountDeletionStates", stateId, {
        nextAttemptAt: Date.now() + delayMs,
      });
      await queueAccountDeletionWorkflow(
        ctx,
        { generation: state.generation, stateId },
        { delayMs }
      );
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
    } else {
      const waiting = await takeSnapshotWaitingAfterRun(ctx, row);
      if (waiting) {
        await queueCardProcessing(ctx, waiting, { archiveOnly: true });
      }
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
 * Sent runs past their kind's silence limit, for the Core Worker's reconcile
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

const HEALTH_SCAN_LIMIT = 500;
const HEALTH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// A due row this old means no flush is taking rows.
const PENDING_STALL_MS = 15 * 60 * 1000;
// The reconcile runs hourly, so a stale run it hasn't looked at for this
// long means the Core Worker stopped reconciling.
const RECONCILE_GRACE_MS = 2 * 60 * 60 * 1000;

export const dispatchHealthValidator = v.object({
  pending: v.number(),
  oldestDueAt: v.union(v.number(), v.null()),
  stalledPending: v.number(),
  sent: v.number(),
  oldestSentAt: v.union(v.number(), v.null()),
  unreconciledSent: v.number(),
  failedLastWeek: v.number(),
  latestFailures: v.array(
    v.object({
      error: v.union(v.string(), v.null()),
      finishedAt: v.number(),
      kind: v.string(),
    })
  ),
  isApproximate: v.boolean(),
});

/** Outbox counts by state and the oldest waiting row of each, bounded. */
export const readDispatchHealth = async (
  ctx: QueryCtx,
  now: number
): Promise<typeof dispatchHealthValidator.type> => {
  const pending = await ctx.db
    .query("workflowDispatches")
    .withIndex("by_state_and_notBefore", (q) => q.eq("state", "pending"))
    .take(HEALTH_SCAN_LIMIT);
  const sent = await ctx.db
    .query("workflowDispatches")
    .withIndex("by_state_and_sentAt", (q) => q.eq("state", "sent"))
    .take(HEALTH_SCAN_LIMIT);
  const failed = await ctx.db
    .query("workflowDispatches")
    .withIndex("by_state_and_finishedAt", (q) =>
      q.eq("state", "failed").gte("finishedAt", now - HEALTH_WINDOW_MS)
    )
    .order("desc")
    .take(HEALTH_SCAN_LIMIT);
  const firstDue = pending[0]?.notBefore;
  return {
    pending: pending.length,
    oldestDueAt: firstDue !== undefined && firstDue <= now ? firstDue : null,
    stalledPending: pending.filter(
      (row) => row.notBefore < now - PENDING_STALL_MS
    ).length,
    sent: sent.length,
    oldestSentAt: sent[0]?.sentAt ?? null,
    unreconciledSent: sent.filter(
      (row) =>
        isStale(row, now - RECONCILE_GRACE_MS) &&
        !((row.lastReconciledAt ?? 0) >= now - RECONCILE_GRACE_MS)
    ).length,
    failedLastWeek: failed.length,
    latestFailures: failed.slice(0, 5).map((row) => ({
      error: row.error ?? null,
      finishedAt: row.finishedAt ?? 0,
      kind: row.kind,
    })),
    isApproximate: [pending, sent, failed].some(
      (rows) => rows.length === HEALTH_SCAN_LIMIT
    ),
  };
};

export const dispatchHealth = internalQuery({
  args: {},
  returns: dispatchHealthValidator,
  handler: (ctx) => readDispatchHealth(ctx, Date.now()),
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
