"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { type ActionCtx, internalAction } from "../_generated/server";
import { CRONS } from "../cronSchedules";
import { catchUpHandler } from "../workosEventCatchUp";
import { captureBackendException } from "./posthog";

const recordHeartbeat = async (
  ctx: Pick<ActionCtx, "runMutation">,
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
export const monitored = async (
  ctx: Pick<ActionCtx, "runMutation">,
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

export const workosEventCatchUp = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRONS.workosEventCatchUp.name, async () => {
      await catchUpHandler(ctx);
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
