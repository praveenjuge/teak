import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Inert unless the deployment explicitly enables audit and pins a witness.
crons.cron(
  "workos-daily-reconciliation-audit",
  "30 4 * * *",
  internal.telemetry.crons.workosDailyReconciliationAudit,
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

// Retain finalized email delivery records for seven days, and unfinished
// records for four weeks for debugging. Component cleanup is bounded and
// schedules its own continuation; it never touches card data. The monitored
// action awaits the initial cleanup batches. Component-owned continuations
// are visible as scheduled functions in Convex, outside that check-in.
crons.cron(
  "cleanup-resend-emails",
  "0 6 * * *",
  (internal as any).telemetry.crons.cleanupResendEmails,
  {}
);

crons.cron(
  "redrive-account-deletion",
  "*/5 * * * *",
  internal.telemetry.crons.redriveAccountDeletion,
  {}
);

export default crons;
