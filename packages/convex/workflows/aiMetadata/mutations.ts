import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { patchCardWithSearchSync } from "../../card/searchDocumentHelpers";
import { colorValidator, processingStatusValidator } from "../../schema";
import { buildColorFacets } from "../../shared/utils/colorUtils";

// Internal mutation to update card with AI metadata
export const updateCardAI = internalMutation({
  args: {
    cardId: v.id("cards"),
    aiTags: v.optional(v.array(v.string())),
    aiSummary: v.optional(v.string()),
    aiTranscript: v.optional(v.string()),
    visualStyles: v.optional(v.array(v.string())),
    processingStatus: processingStatusValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { cardId, processingStatus, ...updates } = args;
    const card = await ctx.db.get("cards", cardId);
    if (!card) {
      return false;
    }
    await patchCardWithSearchSync(ctx, cardId, {
      ...updates,
      ...(processingStatus === undefined ? {} : { processingStatus }),
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const resetCardAI = internalMutation({
  args: {
    cardId: v.id("cards"),
    metadataStatus: v.optional(
      v.union(v.literal("pending"), v.literal("completed"), v.literal("failed"))
    ),
  },
  handler: async (ctx, { cardId, metadataStatus }) => {
    await patchCardWithSearchSync(ctx, cardId, {
      aiTags: undefined,
      aiSummary: undefined,
      aiTranscript: undefined,
      visualStyles: undefined,
      metadataStatus: metadataStatus ?? "pending",
      processingStatus: undefined,
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
