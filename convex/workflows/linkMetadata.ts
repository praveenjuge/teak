import { v } from "convex/values";
import type { RetryBehavior } from "@convex-dev/workpool";
import { internalMutation } from "../_generated/server";
import { workflow } from "./manager";
import { internal } from "../_generated/api";
import { buildErrorPreview } from "../linkMetadata";
import {
  LINK_METADATA_RETRYABLE_PREFIX,
  type LinkMetadataRetryableError,
} from "./steps/linkMetadata/fetchMetadata";
import { Sentry, logger, captureException } from "../sentry";

const internalWorkflow = internal as Record<string, any>;
const linkMetadataInternal = internalWorkflow["linkMetadata"] as Record<string, any>;

const LINK_METADATA_RETRY: RetryBehavior = {
  maxAttempts: 5,
  initialBackoffMs: 5000,
  base: 2,
};

export const parseLinkMetadataRetryableError = (
  error: unknown,
): LinkMetadataRetryableError | null => {
  if (!(error instanceof Error) || typeof error.message !== "string") {
    return null;
  }
  if (!error.message.startsWith(LINK_METADATA_RETRYABLE_PREFIX)) {
    return null;
  }
  const payload = error.message.slice(LINK_METADATA_RETRYABLE_PREFIX.length);
  try {
    return JSON.parse(payload) as LinkMetadataRetryableError;
  } catch {
    return {
      type: "error",
      message: payload,
    };
  }
};

export const linkMetadataWorkflow = workflow.define({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.object({
    success: v.boolean(),
    status: v.string(),
    errorType: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  }),
  handler: async (step, { cardId }) => {
    return Sentry.startSpan(
      {
        op: "workflow.linkMetadata",
        name: `Link Metadata: ${cardId}`,
      },
      async (span) => {
        span.setAttribute("cardId", cardId);

        try {
          const result = await step.runAction(
            internalWorkflow["workflows/steps/linkMetadata/fetchMetadata"]
              .fetchMetadata,
            { cardId },
            { retry: LINK_METADATA_RETRY },
          );

          span.setAttribute("status", result.status);
          logger.info(logger.fmt`Link metadata workflow completed for card ${cardId}`, {
            status: result.status,
          });

          return {
            success: result.status === "success",
            status: result.status,
            errorType: result.errorType,
            errorMessage: result.errorMessage,
          };
        } catch (error) {
          const retryable = parseLinkMetadataRetryableError(error);
          if (!retryable) {
            captureException(error, { cardId, operation: "linkMetadataWorkflow" });
            throw error;
          }

          const normalizedUrl =
            typeof retryable.normalizedUrl === "string"
              ? retryable.normalizedUrl
              : "";

          await step.runMutation(linkMetadataInternal.updateCardMetadata, {
            cardId,
            linkPreview: buildErrorPreview(normalizedUrl, {
              type: retryable.type ?? "error",
              message: retryable.message,
              details: retryable.details,
            }),
            status: "failed",
          });

          span.setAttribute("status", "failed");
          span.setAttribute("errorType", retryable.type ?? "error");
          logger.warn(logger.fmt`Link metadata workflow failed for card ${cardId}`, {
            errorType: retryable.type ?? "error",
            errorMessage: retryable.message,
          });

          return {
            success: false,
            status: "failed",
            errorType: retryable.type ?? "error",
            errorMessage: retryable.message,
          };
        }
      }
    );
  },
});

export const startLinkMetadataWorkflow = internalMutation({
  args: {
    cardId: v.id("cards"),
    startAsync: v.optional(v.boolean()),
  },
  returns: v.object({
    workflowId: v.string(),
  }),
  handler: async (ctx, { cardId, startAsync }) => {
    const workflowId = await workflow.start(
      ctx,
      internalWorkflow["workflows/linkMetadata"].linkMetadataWorkflow,
      { cardId },
      { startAsync: startAsync ?? false },
    );

    return { workflowId };
  },
});
