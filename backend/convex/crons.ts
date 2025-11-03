import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Clean up cards that have been soft-deleted for more than 30 days
// Runs daily at 2:00 AM UTC (off-peak hours)
crons.daily(
  "cleanup-old-deleted-cards",
  { hourUTC: 2, minuteUTC: 0 },
  //@ts-ignore
  internal.workflows.cardCleanup.startCardCleanupWorkflow,
  {}
);

// Generate AI metadata for cards that don't have it yet
// Runs every 6 hours to catch any cards that failed generation
crons.interval(
  "ai-metadata-backfill",
  { hours: 6 },
  internal.tasks.ai.actions.enqueueMissingAiGeneration,
  {}
);

export default crons;
