import { v } from "convex/values";
import { query, internalQuery } from "../../_generated/server";
import {
  applyQuoteDisplayFormatting,
  applyQuoteFormattingToList,
} from "./quoteFormatting";

export const getCard = query({
  args: {
    id: v.id("cards"),
  },
  handler: async (ctx, { id }) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }

    const card = await ctx.db.get(id);
    if (!card || card.userId !== user.subject) {
      return null;
    }

    return applyQuoteDisplayFormatting(card);
  },
});

export const getDeletedCards = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }

    const cards = await ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) =>
        q.eq("userId", user.subject).eq("isDeleted", true)
      )
      .order("desc")
      .take(args.limit || 50);

    return applyQuoteFormattingToList(cards);
  },
});

/**
 * Internal query to get card details for background tasks
 * Used by thumbnail generation and similar internal processes
 */
export const getCardInternal = internalQuery({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    return card;
  },
});
