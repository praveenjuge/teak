"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { TELEMETRY_METRICS } from "../shared/telemetry";
import {
  BACKEND_CARD_METRICS,
  flushBackendTelemetry,
  recordBackendMetric,
  recordBackendOutcome,
  withBackendSpan,
} from "./sentry";

const cardOutcomeValidator = v.union(
  v.literal("success"),
  v.literal("failure")
);
const uploadOutcomeValidator = v.union(
  v.literal("attempt"),
  v.literal("success"),
  v.literal("failure")
);

export const emitCardOutcome = internalAction({
  args: {
    cardId: v.optional(v.string()),
    cardType: v.optional(v.string()),
    errorClass: v.optional(v.string()),
    outcome: cardOutcomeValidator,
    source: v.optional(v.string()),
    userId: v.optional(v.string()),
    workflowId: v.optional(v.string()),
  },
  returns: v.object({ sent: v.boolean() }),
  handler: async (_ctx, args) => {
    try {
      const sent = await recordBackendOutcome({
        attributes: {
          "card.type": args.cardType ?? "unknown",
          "error.class": args.errorClass,
        },
        cardId: args.cardId,
        metric: BACKEND_CARD_METRICS[args.outcome],
        outcome: args.outcome,
        stage: "creation",
        surface: args.source,
        userId: args.userId,
        workflowId: args.workflowId,
      });
      return { sent };
    } catch {
      return { sent: false };
    }
  },
});

export const emitUserCreated = internalAction({
  args: {
    source: v.optional(v.string()),
    userId: v.string(),
  },
  returns: v.object({ sent: v.boolean() }),
  handler: async (_ctx, args) => {
    try {
      const sent = await recordBackendOutcome({
        metric: TELEMETRY_METRICS.userCreated,
        outcome: "success",
        stage: "auth_bootstrap",
        surface: args.source,
        userId: args.userId,
      });
      return { sent };
    } catch {
      return { sent: false };
    }
  },
});

export const emitWorkflowCompletion = internalAction({
  args: {
    cardId: v.string(),
    cardType: v.string(),
    durationMs: v.number(),
  },
  returns: v.object({ sent: v.boolean() }),
  handler: async (_ctx, args) => {
    try {
      await withBackendSpan(
        {
          attributes: { "card.type": args.cardType, outcome: "success" },
          cardId: args.cardId,
          name: "card.processing.completed",
          operation: "teak.workflow",
          stage: "completion",
          surface: "backend",
        },
        () => {
          recordBackendMetric(
            TELEMETRY_METRICS.cardDuration,
            args.durationMs,
            { "card.type": args.cardType, outcome: "success" },
            "millisecond"
          );
          return Promise.resolve();
        }
      );
      await flushBackendTelemetry();
      return { sent: true };
    } catch {
      return { sent: false };
    }
  },
});

export const emitUploadOutcome = internalAction({
  args: {
    bytes: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    fileBucket: v.string(),
    outcome: uploadOutcomeValidator,
    userId: v.optional(v.string()),
  },
  returns: v.object({ sent: v.boolean() }),
  handler: async (_ctx, args) => {
    try {
      await withBackendSpan(
        {
          attributes: {
            "file.bucket": args.fileBucket,
            outcome: args.outcome,
          },
          name: `storage.upload.${args.outcome}`,
          operation: "storage.upload",
          stage: "upload",
          surface: "backend",
          userId: args.userId,
        },
        () => {
          if (args.outcome === "attempt") {
            recordBackendMetric(TELEMETRY_METRICS.uploadAttempts, 1, {
              "file.bucket": args.fileBucket,
              outcome: args.outcome,
            });
          }
          if (args.outcome === "failure") {
            recordBackendMetric(TELEMETRY_METRICS.uploadFailure, 1, {
              "file.bucket": args.fileBucket,
              outcome: args.outcome,
            });
          }
          if (args.outcome === "success" && args.bytes !== undefined) {
            recordBackendMetric(
              TELEMETRY_METRICS.uploadBytes,
              args.bytes,
              { "file.bucket": args.fileBucket, outcome: args.outcome },
              "byte"
            );
          }
          if (args.durationMs !== undefined) {
            recordBackendMetric(
              TELEMETRY_METRICS.uploadDuration,
              args.durationMs,
              { "file.bucket": args.fileBucket, outcome: args.outcome },
              "millisecond"
            );
          }
          return Promise.resolve();
        }
      );
      return { sent: true };
    } catch {
      return { sent: false };
    }
  },
});
