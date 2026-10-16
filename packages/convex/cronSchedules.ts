const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type CronRuntime = "cloudflare" | "convex";

// Every scheduled background task, wherever it runs. `runsOn: "convex"`
// entries are keyed by their handler's export name in telemetry/crons.ts and
// registered in crons.ts. `runsOn: "cloudflare"` entries are Cron Triggers on
// the Files Worker (apps/files-worker/src/cron.ts; `schedule` must match
// `triggers.crons` in its wrangler configs), which record the same heartbeat
// over the workflow RPC gateway. `everyMs` is the interval `schedule` fires
// at, which the console's health view checks against.
export const CRONS = {
  workosEventCatchUp: {
    name: "workos-event-catch-up",
    schedule: "15 * * * *",
    everyMs: HOUR_MS,
    runsOn: "convex",
  },
  cleanupExpiredIdempotency: {
    name: "cleanup-expired-idempotency",
    schedule: "10 * * * *",
    everyMs: HOUR_MS,
    runsOn: "convex",
  },
  cleanupAbandonedImportUploads: {
    name: "cleanup-abandoned-import-uploads",
    schedule: "0 * * * *",
    everyMs: HOUR_MS,
    runsOn: "convex",
  },
  cleanupExpiredUploadSessions: {
    name: "cleanup-expired-upload-sessions",
    schedule: "30 * * * *",
    everyMs: HOUR_MS,
    runsOn: "convex",
  },
  cleanupSemanticSearchCache: {
    name: "cleanup-semantic-search-cache",
    schedule: "40 * * * *",
    everyMs: HOUR_MS,
    runsOn: "convex",
  },
  // After the 00:15 AI usage rollup has written yesterday's final totals.
  adminDailySnapshot: {
    name: "admin-daily-snapshot",
    schedule: "45 0 * * *",
    everyMs: DAY_MS,
    runsOn: "convex",
  },
  cleanupOldDeletedCards: {
    name: "cleanup-old-deleted-cards",
    schedule: "0 2 * * *",
    everyMs: DAY_MS,
    runsOn: "cloudflare",
  },
  cleanupExpiredExports: {
    name: "cleanup-expired-exports",
    schedule: "0 3 * * *",
    everyMs: DAY_MS,
    runsOn: "cloudflare",
  },
  aiMetadataBackfill: {
    name: "ai-metadata-backfill",
    schedule: "0 */6 * * *",
    everyMs: 6 * HOUR_MS,
    runsOn: "cloudflare",
  },
  sweepOrphanedObjects: {
    name: "sweep-orphaned-objects",
    schedule: "0 4 * * 1",
    everyMs: 7 * DAY_MS,
    runsOn: "cloudflare",
  },
  // The backstop for pending uploads whose R2 event never cleaned them up.
  sweepStalePendingUploads: {
    name: "sweep-stale-pending-uploads",
    schedule: "0 4 * * 1",
    everyMs: 7 * DAY_MS,
    runsOn: "cloudflare",
  },
  aiUsageRollup: {
    name: "ai-usage-rollup",
    schedule: "15 * * * *",
    everyMs: HOUR_MS,
    runsOn: "cloudflare",
  },
  reconcileWorkflows: {
    name: "reconcile-workflows",
    schedule: "45 * * * *",
    everyMs: HOUR_MS,
    runsOn: "cloudflare",
  },
} as const satisfies Record<
  string,
  { everyMs: number; name: string; runsOn: CronRuntime; schedule: string }
>;

export type CronTask = keyof typeof CRONS;

/** The tasks Convex runs itself: each is a handler in telemetry/crons.ts. */
export type CronHandler = {
  [Task in CronTask]: (typeof CRONS)[Task]["runsOn"] extends "convex"
    ? Task
    : never;
}[CronTask];

export const cronTasksOn = (runtime: CronRuntime): CronTask[] =>
  (Object.keys(CRONS) as CronTask[]).filter(
    (task) => CRONS[task].runsOn === runtime
  );
