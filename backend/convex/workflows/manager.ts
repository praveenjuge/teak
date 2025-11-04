/**
 * Workflow Manager
 *
 * Central workflow manager instance for the card processing pipeline.
 * Configured with retry behavior for resilient AI processing.
 */

import { v } from "convex/values";
import { WorkflowManager } from "@convex-dev/workflow";
import { internalAction, internalMutation } from "../_generated/server";
// @ts-ignore Convex's generated internal API has recursive types that conflict with strict inference here.
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  buildInitialProcessingStatus,
  stagePending,
} from "../tasks/cards/processingStatus";
import type { CardType } from "../schema";

// @ts-ignore: Convex internal API types recurse deeply; treat as any for workflow wiring.
const internalAny: any = internal as any;

/**
 * Workflow manager for card processing pipeline
 */
export const workflow = new WorkflowManager(components.workflow);

type CardIdentifier = { cardId: Id<"cards"> };

/**
 * Internal mutation used to reset a card's AI fields and mark processing as pending
 * before kicking off the workflow.
 */
export const prepareCardProcessingForWorkflow = internalMutation({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.null(),
  handler: async (ctx, { cardId }: CardIdentifier) => {
    const card = await ctx.db.get(cardId);
    if (!card) {
      throw new Error(`Card ${cardId} not found`);
    }

    const now = Date.now();
    const initialProcessingStatus = buildInitialProcessingStatus({
      now,
      cardType: (card.type ?? "text") as CardType,
      classificationStatus: stagePending(),
    });

    await ctx.db.patch(cardId, {
      aiTags: undefined,
      aiSummary: undefined,
      aiTranscript: undefined,
      aiModelMeta: undefined,
      processingStatus: initialProcessingStatus,
      metadataStatus: "pending",
      updatedAt: now,
    });
  },
});

/**
 * Internal mutation to attach a workflowId to the card once the workflow has started.
 */
export const attachCardWorkflowId = internalMutation({
  args: {
    cardId: v.id("cards"),
    workflowId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { cardId, workflowId }) => {
    await ctx.db.patch(cardId, { workflowId });
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
    await ctx.runMutation(
      internalAny["workflows/manager"].prepareCardProcessingForWorkflow,
      { cardId }
    );

    const workflowRef =
      internalAny["workflows/cardProcessing"].cardProcessingWorkflow;
    const workflowId = await workflow.start(
      ctx,
      workflowRef,
      { cardId },
      { startAsync: true }
    );

    await ctx.runMutation(
      internalAny["workflows/manager"].attachCardWorkflowId,
      { cardId, workflowId }
    );

    return { workflowId };
  },
});
