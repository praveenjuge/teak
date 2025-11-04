/**
 * Categorization Mutations
 *
 * Database mutations for updating categorization results.
 * Separated from index.ts because mutations can't use "use node".
 */

import { v } from "convex/values";
import { internalMutation } from "../../../_generated/server";
import { stageCompleted } from "../../../tasks/cards/processingStatus";
import { internal } from "../../../_generated/api";

const CATEGORIZE_MUTATION_LOG_PREFIX = "[workflow/categorize/mutation]";

/**
 * Internal mutation to update card with categorization result
 */
export const updateCategorization = internalMutation({
  args: {
    cardId: v.id("cards"),
    metadata: v.any(), // LinkCategoryMetadata type
    notifyPipeline: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { cardId, metadata, notifyPipeline }) => {
    console.info(`${CATEGORIZE_MUTATION_LOG_PREFIX} Updating categorization`, {
      cardId,
      category: metadata?.category,
      confidence: metadata?.confidence,
    });
    const now = Date.now();

    // Get current card to update processing status
    const card = await ctx.db.get(cardId);
    if (!card) {
      console.warn(`${CATEGORIZE_MUTATION_LOG_PREFIX} Card not found`, { cardId });
      throw new Error(`Card ${cardId} not found`);
    }

    // Update processing status to mark categorization as complete
    const processingStatus = card.processingStatus || {};
    const updatedProcessing = {
      ...processingStatus,
      categorize: stageCompleted(now, metadata.confidence),
    };

    // Update card metadata with link category
    const updatedMetadata = {
      ...(card.metadata || {}),
      linkCategory: metadata,
    };

    await ctx.db.patch(cardId, {
      metadata: updatedMetadata,
      processingStatus: updatedProcessing,
      updatedAt: now,
    });

    console.info(`${CATEGORIZE_MUTATION_LOG_PREFIX} Categorization stored`, {
      cardId,
      facts: metadata?.facts?.length ?? 0,
      hasImage: !!metadata?.imageUrl,
    });

    if (notifyPipeline) {
      await ctx.scheduler.runAfter(
        0,
        (internal as any)["workflows/manager"].startCardProcessingWorkflow,
        { cardId }
      );
    }

    return null;
  },
});
