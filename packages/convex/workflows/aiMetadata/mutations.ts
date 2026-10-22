import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { accountDeletionOwnsRows } from "../../accountDeletion";
import { mergeProcessingStages } from "../../card/processingStatus";
import { patchCardWithSearchSync } from "../../card/searchSync";
import { storeCardTranscript } from "../../card/textContents";
import { colorValidator, processingStatusValidator } from "../../schema";
import { buildColorFacets } from "../../shared/utils/colorUtils";

export const updateCardAI = internalMutation({
  args: {
    cardId: v.id("cards"),
    aiTags: v.optional(v.array(v.string())),
    aiSummary: v.optional(v.string()),
    aiTranscript: v.optional(v.string()),
    aiOcrText: v.optional(v.string()),
    ocrCheckedAt: v.optional(v.number()),
    visualStyles: v.optional(v.array(v.string())),
    processingStatus: processingStatusValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { cardId, processingStatus, aiOcrText, aiTranscript, ...rest } = args;
    const card = await ctx.db.get("cards", cardId);
    if (!card || (await accountDeletionOwnsRows(ctx, card.userId))) {
      return false;
    }
    const updates = {
      ...rest,
      ...(aiOcrText === undefined ? {} : { aiOcrText: aiOcrText || undefined }),
      ...(aiTranscript === undefined
        ? {}
        : await storeCardTranscript(ctx, card, aiTranscript)),
    };
    return await patchCardWithSearchSync(ctx, cardId, {
      ...updates,
      ...(processingStatus === undefined
        ? {}
        : {
            processingStatus: mergeProcessingStages(
              card.processingStatus,
              processingStatus
            ),
          }),
      updatedAt: Date.now(),
    });
  },
});

export const updateCardColors = internalMutation({
  args: {
    cardId: v.id("cards"),
    colors: v.optional(v.array(colorValidator)),
  },
  handler: async (ctx, { cardId, colors }) => {
    const card = await ctx.db.get("cards", cardId);
    if (!card) {
      return null;
    }
    const { colorHexes, colorHues } = buildColorFacets(colors);
    await patchCardWithSearchSync(ctx, cardId, {
      colors,
      colorHexes,
      colorHues,
      updatedAt: Date.now(),
    });
  },
});
