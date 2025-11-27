/**
 * Workflow Manager
 *
 * Central workflow manager instance for the card processing pipeline.
 * Configured with retry behavior for resilient AI processing.
 */

import { v } from "convex/values";
import { WorkflowManager } from "@convex-dev/workflow";
import { internalAction, internalMutation } from "../_generated/server";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  buildInitialProcessingStatus,
  stagePending,
} from "../card/processingStatus";
import type { CardType } from "../schema";
import { Sentry, logger, captureException } from "../sentry";

const internalAny: any = internal as any;

/**
 * Workflow manager for card processing pipeline
 */
export const workflow = new WorkflowManager(components.workflow);

type CardIdentifier = { cardId: Id<"cards"> };

/**
 * Internal mutation used to reset a card's AI fields, mark processing as pending,
 * and attach the workflowId atomically before the workflow begins executing.
 */
export const initializeCardProcessingState = internalMutation({
  args: {
    cardId: v.id("cards"),
    workflowId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { cardId, workflowId }) => {
    const card = await ctx.db.get(cardId);
    if (!card) {
      throw new Error(`Card ${cardId} not found`);
    }

    const now = Date.now();
    const cardType = (card.type ?? "text") as CardType;
    const linkPreviewStatus = card.metadata?.linkPreview?.status;
    const awaitingLinkMetadata =
      cardType === "link" && linkPreviewStatus !== "success";
    const initialProcessingStatus = buildInitialProcessingStatus({
      now,
      cardType,
      classificationStatus: stagePending(),
    });

    await ctx.db.patch(cardId, {
      aiTags: undefined,
      aiSummary: undefined,
      aiTranscript: undefined,
      aiModelMeta: undefined,
      processingStatus: initialProcessingStatus,
      metadataStatus: awaitingLinkMetadata ? "pending" : "completed",
      updatedAt: now,
      workflowId,
    });
  },
});

/**
 * Action that prepares the card and kicks off the card processing workflow.
 * Returning the workflowId allows callers to track progress if needed.
 */
export const startCardProcessingWorkflow = internalAction({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.object({
    workflowId: v.string(),
  }),
  handler: async (ctx, { cardId }: CardIdentifier) => {
    return Sentry.startSpan(
      {
        op: "workflow.start",
        name: `Start Card Processing: ${cardId}`,
      },
      async (span) => {
        span.setAttribute("cardId", cardId);

        try {
          const workflowRef =
            internalAny["workflows/cardProcessing"].cardProcessingWorkflow;
          const workflowId = await workflow.start(
            ctx,
            workflowRef,
            { cardId },
            { startAsync: true }
          );

          await ctx.runMutation(
            internalAny["workflows/manager"].initializeCardProcessingState,
            { cardId, workflowId }
          );

          span.setAttribute("workflowId", workflowId);
          logger.info(logger.fmt`Card processing workflow started for card ${cardId}`, {
            workflowId,
          });

          return { workflowId };
        } catch (error) {
          captureException(error, { cardId, operation: "startCardProcessingWorkflow" });
          throw error;
        }
      }
    );
  },
});
