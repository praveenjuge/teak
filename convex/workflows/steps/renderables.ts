/**
 * Renderables Generation Step
 *
 * Workflow step that generates thumbnails and other visual assets for cards.
 * Currently handles image card thumbnail generation.
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { stageCompleted } from "../../card/processingStatus";

/**
 * Workflow Step: Generate renderables (thumbnails, etc.)
 *
 * @returns Renderables generation result
 */
export const generate: any = internalAction({
  args: {
    cardId: v.id("cards"),
    cardType: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    thumbnailGenerated: v.boolean(),
  }),
  handler: async (ctx, { cardId, cardType }) => {
    const card = await ctx.runQuery(internal.ai.queries.getCardForAI, {
      cardId,
    });

    if (!card) {
      throw new Error(`Card ${cardId} not found for renderables generation`);
    }

    let thumbnailGenerated = false;

    // Generate thumbnail for image cards
    if (cardType === "image" && card.fileId) {
      await ctx.runAction(
        internal.workflows.steps.renderables.generateThumbnail.generateThumbnail,
        { cardId }
      );
      thumbnailGenerated = true;
    }

    // Update processing status to mark renderables as complete
    const now = Date.now();
    const processingStatus = card.processingStatus || {};
    const updatedProcessing = {
      ...processingStatus,
      renderables: stageCompleted(now, 0.95),
    };

    await ctx.runMutation(internal.ai.mutations.updateCardProcessing, {
      cardId,
      processingStatus: updatedProcessing,
    });

    return {
      success: true,
      thumbnailGenerated,
    };
  },
});
