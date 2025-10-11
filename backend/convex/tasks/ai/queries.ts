import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";

// Internal query to get card data for AI processing
export const getCardForAI = internalQuery({
  args: { cardId: v.id("cards") },
  handler: async (ctx, { cardId }) => {
    return await ctx.db.get(cardId);
  },
});

// Internal query to find cards missing AI metadata
export const findCardsMissingAi = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Find cards that don't have AI metadata (created more than 5 minutes ago to avoid race conditions)
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    const cards = await ctx.db
      .query("cards")
      .filter((q) =>
        q.and(
          q.neq(q.field("isDeleted"), true),
          q.lt(q.field("createdAt"), fiveMinutesAgo),
          q.eq(q.field("aiModelMeta"), undefined)
        )
      )
      .take(50); // Process in batches

    return cards.map((card) => ({ cardId: card._id }));
  },
});

// Internal query to get card for verification
export const getCardForVerification = internalQuery({
  args: { cardId: v.id("cards"), userId: v.string() },
  handler: async (ctx, { cardId, userId }) => {
    const card = await ctx.db.get(cardId);
    if (!card || card.userId !== userId) {
      return null;
    }
    return { exists: true };
  },
});