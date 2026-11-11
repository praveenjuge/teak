import { cardTypeStages } from "@teak/files-protocol";
import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { patchCard } from "../../card/cardWrites";
import type { CardType } from "../../shared/constants";
import {
  mergeProcessingStages,
  stageCompleted,
  stagePending,
} from "../../shared/processingStatus";
import { normalizeQuoteContent } from "../../shared/quoteFormatting";

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
        await patchCard(ctx, cardId, {
          processingStatus: mergeProcessingStages(card.processingStatus, {
            classify: stageCompleted(now, confidence),
          }),
        });
      }
      return null;
    }

    const stages = cardTypeStages(type);
    const updatedProcessing = mergeProcessingStages(card.processingStatus, {
      classify: stageCompleted(now, confidence),
      categorize: stages.categorize ? stagePending() : stageCompleted(now, 1),
      metadata: stagePending(),
      renderables: stages.renderables ? stagePending() : stageCompleted(now, 1),
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

    await patchCard(ctx, cardId, patchData);

    return null;
  },
});
