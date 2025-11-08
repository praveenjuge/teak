import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import {
  cardTypeValidator,
  processingStatusObjectValidator,
} from "../../schema";

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
