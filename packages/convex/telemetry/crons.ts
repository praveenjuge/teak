"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { type ActionCtx, env, internalAction } from "../_generated/server";
import { CRONS } from "../cronSchedules";
import { sweepStalePendingUploadsHandler } from "../storage/pendingUploadCleanup";
import { catchUpHandler } from "../workosEventCatchUp";
import { captureBackendException } from "./posthog";

const internalAny = internal as Record<string, any>;

export const cleanupExpiredIdempotency = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRONS.cleanupExpiredIdempotency.name, async () => {
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
    monitored(ctx, CRONS.cleanupOldDeletedCards.name, async () => {
      await ctx.runMutation(
        internalAny.workflows.cardCleanup.startCardCleanupWorkflow,
        {}
      );
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
    monitored(ctx, CRONS.cleanupAbandonedImportUploads.name, () =>
      ctx.runAction(internalAny["import/runImport"].cleanupExpiredUploads, {})
    ),
});

export const cleanupStalePendingCardUploads = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRONS.cleanupStalePendingCardUploads.name, async () => {
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
    monitored(ctx, CRONS.sweepOrphanedObjects.name, async () => {
      // Two independent reports: a failure in either still runs the other,
      // then fails the cron.
      const results = await Promise.allSettled([
        ctx.runAction(internal.embedding.sweep.sweepVectorLedger, {}),
        ctx.runAction(
          internalAny["workflows/orphanSweep"].sweepOrphanedObjects,
          {}
        ),
      ]);
      for (const result of results) {
        if (result.status === "rejected") {
          throw result.reason;
        }
      }
      return null;
    }),
});

export const aiMetadataBackfill = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRONS.aiMetadataBackfill.name, () =>
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
    monitored(ctx, CRONS.reapStuckWorkflows.name, async () => {
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
    monitored(ctx, CRONS.cleanupExpiredExports.name, () =>
      ctx.runMutation(
        internalAny.workflows.exportCleanup.startExportCleanupWorkflow,
        {}
      )
    ),
});

export const redriveAccountDeletion = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRONS.redriveAccountDeletion.name, () =>
      ctx.runMutation(internal.accountDeletionJobs.redrive, {})
    ),
});

export const workosEventCatchUp = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRONS.workosEventCatchUp.name, async () => {
      await catchUpHandler(ctx);
    }),
});

export const cleanupSemanticSearchCache = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRONS.cleanupSemanticSearchCache.name, async () => {
      await ctx.runMutation(internal.search.semanticCache.cleanupExpired, {});
      await ctx.runMutation(internal.search.relevanceCache.cleanupExpired, {});
    }),
});

export const adminDailySnapshot = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRONS.adminDailySnapshot.name, () =>
      ctx.runAction(internal.adminMetrics.captureDailySnapshot, {})
    ),
});
