"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { type ActionCtx, env, internalAction } from "../_generated/server";
import { CRONS } from "../cronSchedules";
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

export const cleanupAbandonedImportUploads = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRONS.cleanupAbandonedImportUploads.name, () =>
      ctx.runAction(internalAny["import/runImport"].cleanupExpiredUploads, {})
    ),
});

export const cleanupExpiredUploadSessions = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRONS.cleanupExpiredUploadSessions.name, () =>
      ctx.runAction(internalAny.fileUploads.cleanupExpiredMultipartUploads, {})
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
