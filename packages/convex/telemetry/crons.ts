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

// Reports outbox rows no flush takes and stale runs the Core Worker's
// reconcile stopped checking, and starts a flush for the first.
export const workflowDispatchWatchdog = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRONS.workflowDispatchWatchdog.name, async () => {
      const health = await ctx.runQuery(
        internal.workflowDispatch.dispatchHealth,
        {}
      );
      if (health.stalledPending > 0) {
        await ctx.scheduler.runAfter(0, internal.workflowDispatch.flush, {});
      }
      if (health.stalledPending > 0 || health.unreconciledSent > 0) {
        await captureBackendException(new Error("workflow_dispatch_stalled"), {
          properties: {
            cron: CRONS.workflowDispatchWatchdog.name,
            oldest_due_at: health.oldestDueAt,
            oldest_sent_at: health.oldestSentAt,
            stalled_pending: health.stalledPending,
            unreconciled_sent: health.unreconciledSent,
          },
        });
      }
    }),
});

// Deletes pasted link jobs a week after they finished.
export const cleanupFinishedLinkPastes = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRONS.cleanupFinishedLinkPastes.name, () =>
      ctx.runMutation(internal.card.pasteLinks.sweepFinishedLinkPastes, {})
    ),
});

// The Core Worker runs the snapshot now; this only catches a Convex cron
// firing queued before that deploy (.agents/sunset.md).
export const adminDailySnapshot = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(ctx, CRONS.adminDailySnapshot.name, () =>
      ctx.runMutation(internal.adminMetrics.queueSnapshot, {})
    ),
});
