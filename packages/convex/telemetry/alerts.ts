import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, type MutationCtx } from "../_generated/server";
import type { TelemetryAttributes } from "../shared/telemetry";
import { captureBackendException } from "./posthog";

const attributeValidator = v.union(v.string(), v.number(), v.boolean());

// Mutations can't reach PostHog, and a failure of the dispatch outbox can't
// be reported through it, so they hand the report to this action.
export const reportBackgroundFailure = internalAction({
  args: {
    message: v.string(),
    properties: v.optional(v.record(v.string(), attributeValidator)),
  },
  returns: v.null(),
  handler: async (_ctx, { message, properties }) => {
    console.error(`[alerts] ${message}`, properties ?? {});
    await captureBackendException(new Error(message), { properties });
    return null;
  },
});

export const reportFromMutation = async (
  ctx: MutationCtx,
  message: string,
  properties: Record<string, string | number | boolean> = {}
): Promise<void> => {
  await ctx.scheduler.runAfter(
    0,
    internal.telemetry.alerts.reportBackgroundFailure,
    { message, properties: properties satisfies TelemetryAttributes }
  );
};
