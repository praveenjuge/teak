import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import {
  cardTypeValidator,
  colorValidator,
  processingStatusObjectValidator,
  processingStatusValidator,
} from "../../schema";

// Internal mutation to update card with AI metadata
export const updateCardAI = internalMutation({
  args: {
    cardId: v.id("cards"),
    aiTags: v.optional(v.array(v.string())),
    aiSummary: v.optional(v.string()),
    aiTranscript: v.optional(v.string()),
    aiModelMeta: v.object({
      provider: v.string(),
      model: v.string(),
      version: v.optional(v.string()),
      generatedAt: v.optional(v.number()),
    }),
    processingStatus: processingStatusValidator,
  },
  handler: async (ctx, args) => {
    const { cardId, processingStatus, ...updates } = args;
    return await ctx.db.patch(cardId, {
      ...updates,
      ...(processingStatus !== undefined ? { processingStatus } : {}),
      updatedAt: Date.now(),
    });
  },
});

export const updateCardProcessing = internalMutation({
  args: {
    cardId: v.id("cards"),
    processingStatus: processingStatusObjectValidator,
    type: v.optional(cardTypeValidator),
    metadataStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("completed"),
        v.literal("failed")
      )
    ),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { cardId, processingStatus, type, metadataStatus, metadata } = args;
    return await ctx.db.patch(cardId, {
      ...(type ? { type } : {}),
      processingStatus,
      ...(metadataStatus ? { metadataStatus } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
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
    await ctx.db.patch(cardId, {
      colors,
      updatedAt: Date.now(),
    });
  },
});
