/**
 * Classification Mutations
 *
 * Database mutations for updating classification results.
 * Separated from classification.ts because mutations can't use "use node".
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import type { CardType } from "../../schema";
import { stageCompleted, stagePending } from "../../card/processingStatus";
import { normalizeQuoteContent } from "../../card/quoteFormatting";

/**
 * Internal mutation to update card classification result
 */
export const updateClassification = internalMutation({
  args: {
    cardId: v.id("cards"),
    type: v.string(),
    confidence: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { cardId, type, confidence }) => {
    const now = Date.now();

    // Get current card to update processing status
    const card = await ctx.db.get(cardId);
    if (!card) {
      throw new Error(`Card ${cardId} not found`);
    }

    // Update processing status to mark classification as complete
    const processingStatus = card.processingStatus || {};
    const updatedProcessing = {
      ...processingStatus,
      classify: stageCompleted(now, confidence),
      // Mark categorization as pending only for links
      categorize: type === "link"
        ? stagePending()
        : stageCompleted(now, 1),
      // Always mark metadata as pending
      metadata: stagePending(),
      // Mark renderables as pending only for image/video/document
      renderables: ["image", "video", "document"].includes(type)
        ? stagePending()
        : stageCompleted(now, 1),
    };

    const patchData: Record<string, unknown> = {
      type: type as CardType,
      processingStatus: updatedProcessing,
      ...(type === "link" ? { metadataStatus: "pending" } : {}),
    };

    if (type === "quote") {
      const normalization = normalizeQuoteContent(card.content ?? "");
      if (normalization.removedQuotes && normalization.text !== card.content) {
        patchData.content = normalization.text;
      }
    }

    await ctx.db.patch(cardId, patchData);

    return null;
  },
});
