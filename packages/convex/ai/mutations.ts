import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { cardTypeValidator, processingStatusObjectValidator } from "../schema";

export const updateCardProcessing = internalMutation({
  args: {
    cardId: v.id("cards"),
    processingStatus: processingStatusObjectValidator,
    type: v.optional(cardTypeValidator),
    metadataStatus: v.optional(
      v.union(v.literal("pending"), v.literal("completed"), v.literal("failed"))
    ),
    metadata: v.optional(v.any()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { cardId, processingStatus, type, metadataStatus, metadata } = args;
    const card = await ctx.db.get("cards", cardId);
    if (!card) {
      return false;
    }
    await ctx.db.patch("cards", cardId, {
      ...(type ? { type } : {}),
      processingStatus,
      ...(metadataStatus ? { metadataStatus } : {}),
      ...(metadata === undefined ? {} : { metadata }),
      updatedAt: Date.now(),
    });
    return true;
  },
});
