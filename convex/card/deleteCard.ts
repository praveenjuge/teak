import { v } from "convex/values";
import { mutation } from "../_generated/server";

export const permanentDeleteCard = mutation({
  args: {
    id: v.id("cards"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("User must be authenticated");
    }

    const card = await ctx.db.get(args.id);

    if (!card) {
      throw new Error("Card not found");
    }

    if (card.userId !== user.subject) {
      throw new Error("Not authorized to permanently delete this card");
    }

    // Delete associated files if they exist
    if (card.fileId) {
      await ctx.storage.delete(card.fileId);
    }
    if (card.thumbnailId) {
      await ctx.storage.delete(card.thumbnailId);
    }

    // Permanently remove from database
    return await ctx.db.delete(args.id);
  },
});