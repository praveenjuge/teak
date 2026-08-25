import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { cardStorageObjectKeys, deleteObject } from "../storage/r2";

export const permanentDeleteCard = mutation({
  args: {
    id: v.id("cards"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("User must be authenticated");
    }

    const card = await ctx.db.get("cards", args.id);

    if (!card) {
      throw new Error("Card not found");
    }

    if (card.userId !== user.subject) {
      throw new Error("Not authorized to permanently delete this card");
    }

    // Permanently remove from database
    await ctx.db.delete("cards", args.id);
    for (const key of cardStorageObjectKeys(card)) {
      await deleteObject(ctx, key);
    }

    return null;
  },
});
