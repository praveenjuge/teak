import { query } from "../../_generated/server";
import { FREE_TIER_LIMIT } from "@teak/shared/constants";

export const getCardCount = query({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return 0;
    }

    const cards = await ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) =>
        q.eq("userId", user.subject).eq("isDeleted", undefined)
      )
      .collect();

    return cards.length;
  },
});

export const canCreateCard = query({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return false;
    }

    // Get current card count
    const cardCount = await ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) =>
        q.eq("userId", user.subject).eq("isDeleted", undefined)
      )
      .collect();

    // Return true if user has less than FREE_TIER_LIMIT cards (free tier limit)
    return cardCount.length < FREE_TIER_LIMIT;
  },
});