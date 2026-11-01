import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import {
  type EmailAttachmentSkipReason,
  type EmailReceivedOutcome,
  resolveSizeBucket,
  type ServerEventCatalog,
  type ServerEventName,
} from "../shared/analytics";
import { captureBackendEvent } from "./posthog";

// Mutations queue their events in the workflow dispatch outbox
// (`./schedule.ts`). These three actions stay only for jobs scheduled before
// that (`.agents/records/sunset.md`).

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

/**
 * Save by email's server events, scheduled by the HTTP actions in
 * `inbound/http.ts`; never content or addresses.
 */
export const emitInboundEmail = internalAction({
  args: {
    enabled: v.optional(v.boolean()),
    event: v.union(
      v.literal("email_received"),
      v.literal("email_attachment_saved"),
      v.literal("email_attachment_skipped"),
      v.literal("email_save_toggled")
    ),
    kind: v.optional(v.string()),
    outcome: v.optional(
      v.union(
        v.literal("saved"),
        v.literal("dropped_limit"),
        v.literal("dropped_rate"),
        v.literal("deferred_rate"),
        v.literal("empty"),
        v.literal("duplicate")
      )
    ),
    reason: v.optional(
      v.union(v.literal("format"), v.literal("size"), v.literal("limit"))
    ),
    sizeBytes: v.optional(v.number()),
    userId: v.string(),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    await recordInboundEmailEvent(args, (event, properties) =>
      captureBackendEvent(event, args.userId, properties)
    );
    return null;
  },
});

export interface InboundEmailEventArgs {
  enabled?: boolean;
  event:
    | "email_received"
    | "email_attachment_saved"
    | "email_attachment_skipped"
    | "email_save_toggled";
  kind?: string;
  outcome?: EmailReceivedOutcome;
  reason?: EmailAttachmentSkipReason;
  sizeBytes?: number;
  userId: string;
}

export const recordInboundEmailEvent = async (
  args: InboundEmailEventArgs,
  record: <Name extends ServerEventName>(
    event: Name,
    properties: ServerEventCatalog[Name]
  ) => Promise<void>
): Promise<void> => {
  if (args.event === "email_received" && args.outcome) {
    await record(args.event, { outcome: args.outcome });
  } else if (args.event === "email_attachment_saved") {
    await record(args.event, {
      kind: args.kind ?? "other",
      size_bucket: resolveSizeBucket(args.sizeBytes ?? 0),
    });
  } else if (args.event === "email_attachment_skipped" && args.reason) {
    await record(args.event, { reason: args.reason });
  } else if (args.event === "email_save_toggled") {
    await record(args.event, { enabled: args.enabled === true });
  }
};
