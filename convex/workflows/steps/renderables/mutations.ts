import { internalMutation } from "../../../_generated/server";
import { v } from "convex/values";

export const updateCardThumbnail = internalMutation({
  args: {
    cardId: v.id("cards"),
    thumbnailId: v.id("_storage"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("cards", args.cardId, {
      thumbnailId: args.thumbnailId,
      updatedAt: Date.now(),
    });
    return null;
  },
});
