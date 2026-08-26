import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalQuery, query } from "../_generated/server";
import { cardReturnValidator } from "./getCards";
import { attachFileUrls } from "./queryUtils";
import {
  applyQuoteDisplayFormatting,
  applyQuoteFormattingToList,
} from "./quoteFormatting";

export const getCardForUserHandler = async (
  ctx: any,
  userId: string,
  cardId: Id<"cards">
) => {
  const card = await ctx.db.get("cards", cardId);
  if (!card || card.userId !== userId) {
    return null;
  }
  const [hydratedCard] = await attachFileUrls(ctx, [card]);
  return hydratedCard ? applyQuoteDisplayFormatting(hydratedCard) : null;
};

export const getCard = query({
  args: {
    id: v.id("cards"),
  },
  returns: v.union(v.null(), cardReturnValidator),
  handler: async (ctx, { id }) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }

    return getCardForUserHandler(ctx, user.subject, id);
  },
});

export const getCardByUrlId = query({
  args: {
    id: v.string(),
  },
  returns: v.union(v.null(), cardReturnValidator),
  handler: async (ctx, { id }) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }

    const normalizedId = id.trim();
    if (!normalizedId) {
      return null;
    }

    try {
      return await getCardForUserHandler(
        ctx,
        user.subject,
        normalizedId as Id<"cards">
      );
    } catch {
      return null;
    }
  },
});

export const getDeletedCards = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(cardReturnValidator),
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

// Internal query to get card details for background tasks (thumbnail generation, etc.)
export const getCardInternal = internalQuery({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.any(),
  handler: (ctx, args) => ctx.db.get("cards", args.cardId),
});

export const getCardForUser = internalQuery({
  args: {
    userId: v.string(),
    cardId: v.id("cards"),
  },
  returns: v.union(v.null(), cardReturnValidator),
  handler: async (ctx, args) =>
    getCardForUserHandler(ctx, args.userId, args.cardId),
});
