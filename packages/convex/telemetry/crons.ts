"use node";

import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import { type ActionCtx, env, internalAction } from "../_generated/server";
import { sweepStalePendingUploadsHandler } from "../storage/pendingUploadCleanup";
import { catchUpHandler } from "../workosEventCatchUp";
import { captureBackendException } from "./posthog";

const internalAny = internal as Record<string, any>;

// Stable job names, sent with every cron failure report.
export const CRON_MONITORS = {
  cleanupExpiredIdempotency: "cleanup-expired-idempotency",
  aiMetadataBackfill: "ai-metadata-backfill",
  cleanupAbandonedImportUploads: "cleanup-abandoned-import-uploads",
  cleanupExpiredExports: "cleanup-expired-exports",
  cleanupOldDeletedCards: "cleanup-old-deleted-cards",
  cleanupStalePendingCardUploads: "cleanup-stale-pending-card-uploads",
  sweepOrphanedObjects: "sweep-orphaned-objects",
  reapStuckWorkflows: "reap-stuck-workflows",
  cleanupResendEmails: "cleanup-resend-emails",
  redriveAccountDeletion: "redrive-account-deletion",
  workosEventCatchUp: "workos-event-catch-up",
  adminDailySnapshot: "admin-daily-snapshot",
} as const;

export const cleanupExpiredIdempotency = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRON_MONITORS.cleanupExpiredIdempotency, async () => {
      if (env.OPERATIONAL_RETENTION_ENABLED !== "true") {
        return;
      }
      await ctx.runMutation(
        internal.operationalRetention.cleanupExpiredRecords,
        {
          kind: "idempotency",
          dryRun: false,
        }
      );
    }),
});

// Heartbeats feed the console's health view; a failed write never fails the
// job itself.
const recordHeartbeat = async (
  ctx: ActionCtx,
  args: {
    name: string;
    phase: "started" | "succeeded" | "failed";
    error?: string;
  }
) => {
  try {
    await ctx.runMutation(internal.adminHealth.recordCronRun, args);
  } catch (error) {
    console.error("[crons] failed to record heartbeat", error);
  }
};

// Crons never retry, so every failure is reported, then rethrown for the logs.
const monitored = async (
  ctx: ActionCtx,
  slug: string,
  callback: () => Promise<unknown>
): Promise<null> => {
  await recordHeartbeat(ctx, { name: slug, phase: "started" });
  try {
    await callback();
  } catch (error) {
    await recordHeartbeat(ctx, {
      name: slug,
      phase: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    await captureBackendException(error, {
      properties: { cron: slug, stage: "cron" },
    });
    throw error;
  }
  await recordHeartbeat(ctx, { name: slug, phase: "succeeded" });
  return null;
};

export const cleanupOldDeletedCards = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRON_MONITORS.cleanupOldDeletedCards, async () => {
      await ctx.runMutation(
        internalAny.workflows.cardCleanup.startCardCleanupWorkflow,
        {}
      );
      // Tombstones of purged cards back /v1/cards/changes for 90 days.
      await ctx.runMutation(
        internalAny.publicApiTombstones.pruneExpiredCardTombstones,
        {}
      );
    }),
});

export const cleanupAbandonedImportUploads = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRON_MONITORS.cleanupAbandonedImportUploads, () =>
      ctx.runAction(internalAny["import/runImport"].cleanupExpiredUploads, {})
    ),
});

export const cleanupStalePendingCardUploads = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRON_MONITORS.cleanupStalePendingCardUploads, async () => {
      await sweepStalePendingUploadsHandler(ctx);
      await ctx.runAction(
        internalAny.fileUploads.cleanupExpiredMultipartUploads,
        {}
      );
    }),
});

export const sweepOrphanedObjects = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRON_MONITORS.sweepOrphanedObjects, async () => {
      await ctx.runAction(
        internalAny["workflows/orphanSweep"].sweepOrphanedObjects,
        {}
      );
      return null;
    }),
});

export const aiMetadataBackfill = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRON_MONITORS.aiMetadataBackfill, () =>
      ctx.runMutation(
        internalAny.workflows.aiBackfill.startAiBackfillWorkflow,
        {}
      )
    ),
});

export const reapStuckWorkflows = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRON_MONITORS.reapStuckWorkflows, async () => {
      await ctx.runAction(
        internalAny["workflows/manager"].reapStuckWorkflows,
        {}
      );
      return null;
    }),
});

export const cleanupExpiredExports = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRON_MONITORS.cleanupExpiredExports, () =>
      ctx.runMutation(
        internalAny.workflows.exportCleanup.startExportCleanupWorkflow,
        {}
      )
    ),
});

export const cleanupResendEmails = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRON_MONITORS.cleanupResendEmails, async () => {
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
      await ctx.runMutation(components.resend.lib.cleanupOldEmails, {
        olderThan: oneWeekMs,
      });
      await ctx.runMutation(components.resend.lib.cleanupAbandonedEmails, {
        olderThan: 4 * oneWeekMs,
      });
    }),
});

export const redriveAccountDeletion = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRON_MONITORS.redriveAccountDeletion, () =>
      ctx.runMutation(internal.accountDeletionJobs.redrive, {})
    ),
});

export const workosEventCatchUp = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRON_MONITORS.workosEventCatchUp, async () => {
      await catchUpHandler(ctx);
    }),
});

export const adminDailySnapshot = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRON_MONITORS.adminDailySnapshot, () =>
      ctx.runAction(internal.adminMetrics.captureDailySnapshot, {})
    ),
});
