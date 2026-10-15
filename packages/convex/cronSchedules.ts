const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// Keyed by the handler's export name in telemetry/crons.ts. `everyMs` is the
// interval `schedule` fires at, which the console's health view checks against.
export const CRONS = {
  workosEventCatchUp: {
    name: "workos-event-catch-up",
    schedule: "15 * * * *",
    everyMs: HOUR_MS,
  },
  cleanupExpiredIdempotency: {
    name: "cleanup-expired-idempotency",
    schedule: "10 * * * *",
    everyMs: HOUR_MS,
  },
  cleanupOldDeletedCards: {
    name: "cleanup-old-deleted-cards",
    schedule: "0 2 * * *",
    everyMs: DAY_MS,
  },
  cleanupAbandonedImportUploads: {
    name: "cleanup-abandoned-import-uploads",
    schedule: "0 * * * *",
    everyMs: HOUR_MS,
  },
  cleanupStalePendingCardUploads: {
    name: "cleanup-stale-pending-card-uploads",
    schedule: "30 * * * *",
    everyMs: HOUR_MS,
  },
  sweepOrphanedObjects: {
    name: "sweep-orphaned-objects",
    schedule: "0 4 * * 1",
    everyMs: 7 * DAY_MS,
  },
  reapStuckWorkflows: {
    name: "reap-stuck-workflows",
    schedule: "0 5 * * 1",
    everyMs: 7 * DAY_MS,
  },
  aiMetadataBackfill: {
    name: "ai-metadata-backfill",
    schedule: "0 */6 * * *",
    everyMs: 6 * HOUR_MS,
  },
  cleanupExpiredExports: {
    name: "cleanup-expired-exports",
    schedule: "0 3 * * *",
    everyMs: DAY_MS,
  },
  adminDailySnapshot: {
    name: "admin-daily-snapshot",
    schedule: "20 0 * * *",
    everyMs: DAY_MS,
  },
  redriveAccountDeletion: {
    name: "redrive-account-deletion",
    schedule: "*/5 * * * *",
    everyMs: 5 * MINUTE_MS,
  },
  cleanupSemanticSearchCache: {
    name: "cleanup-semantic-search-cache",
    schedule: "40 * * * *",
    everyMs: HOUR_MS,
  },
} as const;

export type CronHandler = keyof typeof CRONS;
