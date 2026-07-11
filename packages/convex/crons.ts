import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Ensure the first-party OAuth clients (Raycast, desktop) exist as
// `oauthApplication` rows. The mcp plugin resolves clients from the DB, so the
// browser-login flow returns `invalid_client` if these are missing.
//
// Convex runs an interval cron's FIRST execution at deploy time (see
// https://docs.convex.dev/scheduling/cron-jobs), so a brand-new deployment
// seeds these clients as part of the deploy rather than up to an interval
// later; the recurring interval then just re-asserts them and corrects drift.
// Also runnable on demand via `bunx convex run oauthClients:ensureOAuthClients`.
crons.cron(
  "ensure-oauth-clients",
  "*/15 * * * *",
  (internal as any).telemetry.crons.ensureOauthClients,
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

export default crons;
