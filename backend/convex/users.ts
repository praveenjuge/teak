import { mutation } from "./_generated/server";

export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("User must be authenticated");
    }

    const userId = identity.subject;

    const cards = await ctx.db
      .query("cards")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    for (const card of cards) {
      if (card.fileId) {
        await ctx.storage.delete(card.fileId);
      }
      if (card.thumbnailId) {
        await ctx.storage.delete(card.thumbnailId);
      }

      await ctx.db.delete(card._id);
    }

    return { deletedCards: cards.length };
  },
});
