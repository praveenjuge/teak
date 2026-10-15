import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Replays WorkOS user events a webhook may have missed (Events API).
crons.cron(
  "workos-event-catch-up",
  "15 * * * *",
  internal.telemetry.crons.workosEventCatchUp,
  {}
);

crons.cron(
  "cleanup-expired-idempotency",
  "10 * * * *",
  internal.telemetry.crons.cleanupExpiredIdempotency,
  {}
);

// Clean up cards that have been soft-deleted for more than 30 days
// Runs daily at 2:00 AM UTC (off-peak hours)
crons.cron(
  "cleanup-old-deleted-cards",
  "0 2 * * *",
  (internal as any).telemetry.crons.cleanupOldDeletedCards,
  {}
);

crons.cron(
  "cleanup-abandoned-import-uploads",
  "0 * * * *",
  (internal as any).telemetry.crons.cleanupAbandonedImportUploads,
  {}
);

crons.cron(
  "cleanup-stale-pending-card-uploads",
  "30 * * * *",
  (internal as any).telemetry.crons.cleanupStalePendingCardUploads,
  {}
);

// Weekly report-only reconciliation of orphaned storage objects (Mondays 04:00 UTC)
crons.cron(
  "sweep-orphaned-objects",
  "0 4 * * 1",
  (internal as any).telemetry.crons.sweepOrphanedObjects,
  {}
);

// Cancel and clean workflows stuck in progress beyond the seven-day retention
// horizon so they stop keeping the workpool loop hot (Mondays 05:00 UTC)
crons.cron(
  "reap-stuck-workflows",
  "0 5 * * 1",
  (internal as any).telemetry.crons.reapStuckWorkflows,
  {}
);

// Generate AI metadata for cards that don't have it yet
// Runs every 6 hours to catch any cards that failed generation
crons.cron(
  "ai-metadata-backfill",
  "0 */6 * * *",
  (internal as any).telemetry.crons.aiMetadataBackfill,
  {}
);

// Delete expired export artifacts, remove leftover snapshot items, and mark
// jobs expired. Runs daily at 3:00 AM UTC (off-peak, after card cleanup).
crons.cron(
  "cleanup-expired-exports",
  "0 3 * * *",
  (internal as any).telemetry.crons.cleanupExpiredExports,
  {}
);

// Saves yesterday's business metrics for the superadmin console's trends.
crons.cron(
  "admin-daily-snapshot",
  "20 0 * * *",
  internal.telemetry.crons.adminDailySnapshot,
  {}
);

crons.cron(
  "redrive-account-deletion",
  "*/5 * * * *",
  internal.telemetry.crons.redriveAccountDeletion,
  {}
);

// Removes search meaning matches past their ten minutes.
crons.cron(
  "cleanup-semantic-search-cache",
  "40 * * * *",
  internal.telemetry.crons.cleanupSemanticSearchCache,
  {}
);

export default crons;
