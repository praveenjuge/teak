/**
 * Classification Mutations
 *
 * Database mutations for updating classification results.
 * Separated from classification.ts because mutations can't use "use node".
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { stageCompleted, stagePending } from "../../card/processingStatus";
import { normalizeQuoteContent } from "../../card/quoteFormatting";
import { patchCardWithSearchSync } from "../../card/searchDocumentHelpers";
import type { CardType } from "../../schema";

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
    const card = await ctx.db.get("cards", cardId);
    if (!card) {
      return null;
    }

    // Update processing status to mark classification as complete
    const processingStatus = card.processingStatus || {};
    const updatedProcessing = {
      ...processingStatus,
      classify: stageCompleted(now, confidence),
      // Mark categorization as pending only for links
      categorize: type === "link" ? stagePending() : stageCompleted(now, 1),
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

    await patchCardWithSearchSync(ctx, cardId, patchData);

    return null;
  },
});

/**
 * Internal mutation to mark the classification stage as completed without
 * changing the card type. updateClassification only runs when classification
 * changes the type; when re-classification confirms the existing type this
 * records stage completion so downstream steps gated on
 * processingStatus.classify (link metadata fetching) are not stuck retrying
 * until they fail permanently.
 */
export const markClassificationCompleted = internalMutation({
  args: {
    cardId: v.id("cards"),
    confidence: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { cardId, confidence }) => {
    const card = await ctx.db.get("cards", cardId);
    if (!card) {
      return null;
    }

    if (card.processingStatus?.classify?.status === "completed") {
      return null;
    }

    await patchCardWithSearchSync(ctx, cardId, {
      processingStatus: {
        ...(card.processingStatus ?? {}),
        classify: stageCompleted(Date.now(), confidence),
      },
    });

    return null;
  },
});
