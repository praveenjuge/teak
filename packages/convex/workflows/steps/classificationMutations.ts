import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import {
  mergeProcessingStages,
  stageCompleted,
  stagePending,
} from "../../card/processingStatus";
import { normalizeQuoteContent } from "../../card/quoteFormatting";
import { patchCardWithSearchSync } from "../../card/searchDocumentHelpers";
import type { CardType } from "../../schema";

export const recordClassification = internalMutation({
  args: {
    cardId: v.id("cards"),
    type: v.optional(v.string()),
    confidence: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { cardId, type, confidence }) => {
    const now = Date.now();

    const card = await ctx.db.get("cards", cardId);
    if (!card) {
      return null;
    }

    if (type === undefined) {
      if (card.processingStatus?.classify?.status !== "completed") {
        await patchCardWithSearchSync(ctx, cardId, {
          processingStatus: mergeProcessingStages(card.processingStatus, {
            classify: stageCompleted(now, confidence),
          }),
        });
      }
      return null;
    }

    const updatedProcessing = mergeProcessingStages(card.processingStatus, {
      classify: stageCompleted(now, confidence),
      categorize: type === "link" ? stagePending() : stageCompleted(now, 1),
      metadata: stagePending(),
      renderables: ["image", "video", "document"].includes(type)
        ? stagePending()
        : stageCompleted(now, 1),
    });

    const patchData: Record<string, unknown> = {
      type: type as CardType,
      processingStatus: updatedProcessing,
      ...(type === "link" ? { metadataStatus: "pending" } : {}),
    };

    if (card.type === "palette" && type !== "palette") {
      patchData.colors = undefined;
      patchData.colorHexes = undefined;
      patchData.colorHues = undefined;
    }

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
