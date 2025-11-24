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

export const resetCardAI = internalMutation({
  args: {
    cardId: v.id("cards"),
    metadataStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("completed"),
        v.literal("failed"),
      ),
    ),
  },
  handler: async (ctx, { cardId, metadataStatus }) => {
    await ctx.db.patch(cardId, {
      aiTags: undefined,
      aiSummary: undefined,
      aiTranscript: undefined,
      aiModelMeta: undefined,
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
    await ctx.db.patch(cardId, {
      colors,
      updatedAt: Date.now(),
    });
  },
});
