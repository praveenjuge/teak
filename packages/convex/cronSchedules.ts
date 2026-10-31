const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type CronRuntime = "cloudflare" | "convex";

export const CRONS = {
  // Runs on Convex so a broken link to the Core Worker is still noticed.
  workflowDispatchWatchdog: {
    name: "workflow-dispatch-watchdog",
    schedule: "35 * * * *",
    everyMs: HOUR_MS,
    runsOn: "convex",
  },
  // Pasted link jobs a week after they finish (card/pasteLinks.ts). Daily
  // and small, so it stays on Convex beside the job itself.
  cleanupFinishedLinkPastes: {
    name: "cleanup-finished-link-pastes",
    schedule: "25 3 * * *",
    everyMs: DAY_MS,
    runsOn: "convex",
  },
  // The Core Worker runs the hourly cleanups with the workflow reconcile.
  cleanupExpiredIdempotency: {
    name: "cleanup-expired-idempotency",
    schedule: "45 * * * *",
    everyMs: HOUR_MS,
    runsOn: "cloudflare",
  },
  cleanupAbandonedImportUploads: {
    name: "cleanup-abandoned-import-uploads",
    schedule: "45 * * * *",
    everyMs: HOUR_MS,
    runsOn: "cloudflare",
  },
  cleanupExpiredUploadSessions: {
    name: "cleanup-expired-upload-sessions",
    schedule: "45 * * * *",
    everyMs: HOUR_MS,
    runsOn: "cloudflare",
  },
  cleanupSemanticSearchCache: {
    name: "cleanup-semantic-search-cache",
    schedule: "45 * * * *",
    everyMs: HOUR_MS,
    runsOn: "cloudflare",
  },
  // Save by email receipts past any sender's redelivery window, pruned by the
  // maintenance workflow with the export cleanup.
  cleanupInboundEmailReceipts: {
    name: "cleanup-inbound-email-receipts",
    schedule: "0 3 * * *",
    everyMs: DAY_MS,
    runsOn: "cloudflare",
  },
  // After the AI usage rollup has finalized yesterday; shares card cleanup's
  // Cron Trigger.
  adminDailySnapshot: {
    name: "admin-daily-snapshot",
    schedule: "0 2 * * *",
    everyMs: DAY_MS,
    runsOn: "cloudflare",
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

export type CronHandler = {
  [Task in CronTask]: (typeof CRONS)[Task]["runsOn"] extends "convex"
    ? Task
    : never;
}[CronTask];

export const cronTasksOn = (runtime: CronRuntime): CronTask[] =>
  (Object.keys(CRONS) as CronTask[]).filter(
    (task) => CRONS[task].runsOn === runtime
  );
