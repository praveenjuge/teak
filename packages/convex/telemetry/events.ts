import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { captureBackendEvent } from "./posthog";

export const emitCardOutcome = internalAction({
  args: {
    cardId: v.optional(v.string()),
    cardType: v.optional(v.string()),
    errorClass: v.optional(v.string()),
    outcome: v.union(v.literal("success"), v.literal("failure")),
    source: v.optional(v.string()),
    userId: v.optional(v.string()),
    workflowId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    const properties = {
      card_type: args.cardType ?? "unknown",
      source: args.source ?? "unknown",
    };
    if (args.outcome === "success") {
      await captureBackendEvent("card_created", args.userId, properties);
    } else {
      await captureBackendEvent("card_create_failed", args.userId, {
        ...properties,
        error_class: args.errorClass,
      });
    }
    return null;
  },
});

export const emitUserCreated = internalAction({
  args: {
    email: v.optional(v.string()),
    source: v.optional(v.string()),
    userId: v.string(),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    await captureBackendEvent(
      "user_signed_up",
      args.userId,
      { source: args.source },
      {
        set: {
          ...(args.email ? { email: args.email } : {}),
          plan: "free",
          signed_up_at: new Date().toISOString(),
        },
      }
    );
    return null;
  },
});

export const emitCardProcessingFailed = internalAction({
  args: {
    cardType: v.optional(v.string()),
    errorClass: v.string(),
    stage: v.string(),
    userId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    await captureBackendEvent("card_processing_failed", args.userId, {
      card_type: args.cardType,
      error_class: args.errorClass,
      stage: args.stage,
    });
    return null;
  },
});

// Run as a workflow step, so its name and arguments stay stable for journals.
export const emitWorkflowCompletion = internalAction({
  args: {
    cardId: v.string(),
    cardType: v.string(),
    durationMs: v.number(),
  },
  returns: v.object({ sent: v.boolean() }),
  handler: async (_ctx, args) => {
    await captureBackendEvent("card_processing_completed", undefined, {
      card_type: args.cardType,
      duration_ms: args.durationMs,
    });
    return { sent: true };
  },
});
