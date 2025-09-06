import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";

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
  },
  handler: async (ctx, args) => {
    const { cardId, ...updates } = args;
    return await ctx.db.patch(cardId, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});