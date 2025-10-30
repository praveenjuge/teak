/**
 * Categorization Mutations
 *
 * Database mutations for updating categorization results.
 * Separated from index.ts because mutations can't use "use node".
 */

import { v } from "convex/values";
import { internalMutation } from "../../../../_generated/server";
import { stageCompleted } from "../../../cards/processingStatus";

/**
 * Internal mutation to update card with categorization result
 */
export const updateCategorization = internalMutation({
  args: {
    cardId: v.id("cards"),
    metadata: v.any(), // LinkCategoryMetadata type
  },
  returns: v.null(),
  handler: async (ctx, { cardId, metadata }) => {
    const now = Date.now();

    // Get current card to update processing status
    const card = await ctx.db.get(cardId);
    if (!card) {
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
    });

    return null;
  },
});
