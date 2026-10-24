import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { type QueryCtx, query } from "../_generated/server";
import { getSessionUser, type TeakUserId } from "../securitySessions";
import { clampSearchLimit } from "../shared/search/constants";
import { cardReturnValidator } from "./getCards";
import { excludeHiddenRows, keepVisible } from "./hiddenCards";
import { attachCardDetailUrls, omitCardText } from "./queryUtils";
import {
  applyQuoteDisplayFormatting,
  applyQuoteFormattingToList,
} from "./quoteFormatting";

export const getCardForUserHandler = async (
  ctx: Pick<QueryCtx, "db">,
  userId: TeakUserId,
  cardId: Id<"cards">
) => {
  const card = await ctx.db.get("cards", cardId);
  if (!card || card.userId !== userId) {
    return null;
  }
  return applyQuoteDisplayFormatting(await attachCardDetailUrls(ctx, card));
};

export const getCard = query({
  args: {
    id: v.id("cards"),
  },
  returns: v.union(v.null(), cardReturnValidator),
  handler: async (ctx, { id }) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return null;
    }

    return getCardForUserHandler(ctx, user.teakUserId, id);
  },
});

export const getCardByUrlId = query({
  args: {
    id: v.string(),
  },
  returns: v.union(v.null(), cardReturnValidator),
  handler: async (ctx, { id }) => {
    const user = await getSessionUser(ctx);
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
        user.teakUserId,
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
    const user = await getSessionUser(ctx);
    if (!user) {
      return [];
    }

    // Flagged hidden cards are skipped while reading, so they never use up
    // the limit; `keepVisible` below catches any the backfill hasn't flagged.
    const cards = await excludeHiddenRows(
      ctx.db
        .query("cards")
        .withIndex("by_user_deleted_saved", (q) =>
          q.eq("userId", user.teakUserId).eq("isDeleted", true)
        )
    )
      .order("desc")
      .take(clampSearchLimit(args.limit));

    return applyQuoteFormattingToList(
      keepVisible(cards).map(
        ({ workflowArtifactKeys: _internalKeys, ...card }) => omitCardText(card)
      )
    );
  },
});
