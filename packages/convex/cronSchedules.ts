const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type CronRuntime = "cloudflare" | "convex";

/**
 * Which schedules the Core Worker runs. The development Worker (its
 * `CRON_PROFILE` var) runs the hourly tasks every six hours and the AI
 * backfill daily, so the shared dev deployment isn't billed for production's
 * cadence; production and self-hosted Workers keep `schedule`.
 */
export type CronProfile = "development" | "production";

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
  // Folder rule runs a day after they start, when their undo ends
  // (folder/rules.ts). Small, beside the runs themselves.
  cleanupExpiredFolderRuleRuns: {
    name: "cleanup-expired-folder-rule-runs",
    schedule: "15 * * * *",
    everyMs: HOUR_MS,
    runsOn: "convex",
  },
  cleanupExpiredIdempotency: {
    name: "cleanup-expired-idempotency",
    schedule: "45 * * * *",
    everyMs: HOUR_MS,
    devSchedule: "45 */6 * * *",
    devEveryMs: 6 * HOUR_MS,
    runsOn: "cloudflare",
  },
  cleanupAbandonedImportUploads: {
    name: "cleanup-abandoned-import-uploads",
    schedule: "45 * * * *",
    everyMs: HOUR_MS,
    devSchedule: "45 */6 * * *",
    devEveryMs: 6 * HOUR_MS,
    runsOn: "cloudflare",
  },
  cleanupExpiredUploadSessions: {
    name: "cleanup-expired-upload-sessions",
    schedule: "45 * * * *",
    everyMs: HOUR_MS,
    devSchedule: "45 */6 * * *",
    devEveryMs: 6 * HOUR_MS,
    runsOn: "cloudflare",
  },
  cleanupSemanticSearchCache: {
    name: "cleanup-semantic-search-cache",
    schedule: "45 * * * *",
    everyMs: HOUR_MS,
    devSchedule: "45 */6 * * *",
    devEveryMs: 6 * HOUR_MS,
    runsOn: "cloudflare",
  },
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
    devSchedule: "0 2 * * *",
    devEveryMs: DAY_MS,
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
    devSchedule: "15 */6 * * *",
    devEveryMs: 6 * HOUR_MS,
    runsOn: "cloudflare",
  },
  reconcileWorkflows: {
    name: "reconcile-workflows",
    schedule: "45 * * * *",
    everyMs: HOUR_MS,
    devSchedule: "45 */6 * * *",
    devEveryMs: 6 * HOUR_MS,
    runsOn: "cloudflare",
  },
} as const satisfies Record<
  string,
  {
    devEveryMs?: number;
    devSchedule?: string;
    everyMs: number;
    name: string;
    runsOn: CronRuntime;
    schedule: string;
  }
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

type CronSpec = (typeof CRONS)[CronTask] & {
  devEveryMs?: number;
  devSchedule?: string;
};

export const cronProfile = (value: string | undefined): CronProfile =>
  value === "development" ? "development" : "production";

export const scheduleFor = (task: CronTask, profile: CronProfile): string => {
  const spec: CronSpec = CRONS[task];
  return profile === "development"
    ? (spec.devSchedule ?? spec.schedule)
    : spec.schedule;
};

export const everyMsFor = (task: CronTask, profile: CronProfile): number => {
  const spec: CronSpec = CRONS[task];
  return profile === "development"
    ? (spec.devEveryMs ?? spec.everyMs)
    : spec.everyMs;
};
