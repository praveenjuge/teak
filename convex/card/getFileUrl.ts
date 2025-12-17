import { v } from "convex/values";
import { query } from "../_generated/server";

export const getFileUrl = query({
  args: {
    fileId: v.id("_storage"),
    cardId: v.optional(v.id("cards")), // Optional: for additional security verification
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();

    // If cardId is provided, verify the user owns the card that references this file
    if (args.cardId && user) {
      const card = await ctx.db.get("cards", args.cardId);
      if (!card || card.userId !== user.subject) {
        throw new Error("Unauthorized access to file");
      }
    }

    return await ctx.storage.getUrl(args.fileId);
  },
});