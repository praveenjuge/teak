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
import { stageCompleted } from "../../tasks/cards/processingStatus";

const RENDERABLES_LOG_PREFIX = "[workflow/renderables]";

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
    console.info(`${RENDERABLES_LOG_PREFIX} Running`, { cardId, cardType });
    const card = await ctx.runQuery(internal.tasks.ai.queries.getCardForAI, {
      cardId,
    });

    if (!card) {
      console.warn(`${RENDERABLES_LOG_PREFIX} Card not found`, { cardId });
      throw new Error(`Card ${cardId} not found for renderables generation`);
    }

    let thumbnailGenerated = false;

    // Generate thumbnail for image cards
    if (cardType === "image" && card.fileId) {
      console.info(`${RENDERABLES_LOG_PREFIX} Generating thumbnail`, {
        cardId,
        fileId: card.fileId,
      });
      await ctx.runAction(
        internal.tasks.thumbnails.generateThumbnail.generateThumbnail,
        { cardId }
      );
      thumbnailGenerated = true;
    }

    if (!thumbnailGenerated) {
      console.info(`${RENDERABLES_LOG_PREFIX} No thumbnail generation required`, {
        cardId,
        cardType,
      });
    }

    // Update processing status to mark renderables as complete
    const now = Date.now();
    const processingStatus = card.processingStatus || {};
    const updatedProcessing = {
      ...processingStatus,
      renderables: stageCompleted(now, 0.95),
    };

    await ctx.runMutation(internal.tasks.ai.mutations.updateCardProcessing, {
      cardId,
      processingStatus: updatedProcessing,
    });

    console.info(`${RENDERABLES_LOG_PREFIX} Completed`, {
      cardId,
      thumbnailGenerated,
    });

    return {
      success: true,
      thumbnailGenerated,
    };
  },
});
