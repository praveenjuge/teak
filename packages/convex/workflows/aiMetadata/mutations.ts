import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { accountDeletionOwnsRows } from "../../accountDeletion";
import { mergeProcessingStages } from "../../card/processingStatus";
import { patchCardWithSearchSync } from "../../card/searchSync";
import { storeCardTranscript } from "../../card/textContents";
import { autoFileCard } from "../../folder/rules";
import { colorValidator, processingStatusValidator } from "../../schema";
import { buildColorFacets } from "../../shared/utils/colorUtils";

export const updateCardAI = internalMutation({
  args: {
    cardId: v.id("cards"),
    aiTags: v.optional(v.array(v.string())),
    aiSummary: v.optional(v.string()),
    /** The language of `aiSummary` and `aiTags`; sent with them or not at all. */
    aiLanguage: v.optional(v.string()),
    aiTranscript: v.optional(v.string()),
    aiOcrText: v.optional(v.string()),
    ocrCheckedAt: v.optional(v.number()),
    visualStyles: v.optional(v.array(v.string())),
    processingStatus: processingStatusValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const {
      cardId,
      processingStatus,
      aiLanguage,
      aiOcrText,
      aiTranscript,
      ...rest
    } = args;
    const card = await ctx.db.get("cards", cardId);
    if (!card || (await accountDeletionOwnsRows(ctx, card.userId))) {
      return false;
    }
    // New AI tags or a new summary bring their language, or clear the old
    // one: a stored language always describes the stored output.
    const writesAiOutput =
      args.aiTags !== undefined || args.aiSummary !== undefined;
    const updates = {
      ...rest,
      ...(writesAiOutput ? { aiLanguage } : {}),
      ...(aiOcrText === undefined ? {} : { aiOcrText: aiOcrText || undefined }),
      ...(aiTranscript === undefined
        ? {}
        : await storeCardTranscript(ctx, card, aiTranscript)),
    };
    // New AI output (tags, or a summary alone) is when the card is ready for
    // folder rules: file it with what it now holds, in the same write. Text
    // read from images later (a link's screenshot) checks again, but only on
    // a card whose AI has run, so an early OCR write files nothing.
    const aiDone =
      writesAiOutput ||
      (aiOcrText !== undefined &&
        (card.aiTags !== undefined || card.aiSummary !== undefined));
    const filed = aiDone
      ? await autoFileCard(
          ctx,
          { ...card, ...updates },
          aiTranscript || undefined
        )
      : undefined;
    return await patchCardWithSearchSync(ctx, cardId, {
      ...updates,
      ...(filed?.folderIds ? { folderIds: filed.folderIds } : {}),
      ...(filed?.tags ? { tags: filed.tags } : {}),
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
