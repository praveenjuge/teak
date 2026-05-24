import { v } from "convex/values";
import { internalQuery, query } from "../_generated/server";
import { attachFileUrls } from "./queryUtils";
import { cardReturnValidator } from "./getCards";

export const findDuplicateCardForUserHandler = async (
  ctx: any,
  userId: string,
  url: string
) => {
  // Find the most recent non-deleted card with the same URL
  const duplicate = await ctx.db
    .query("cards")
    .withIndex("by_user_url_deleted", (q: any) =>
      q.eq("userId", userId).eq("url", url).eq("isDeleted", undefined)
    )
    .order("desc")
    .first();

  if (!duplicate) {
    return null;
  }

  return (await attachFileUrls(ctx, [duplicate]))[0] ?? null;
};

// Check if a card with the given URL already exists for the current user
export const findDuplicateCard = query({
  args: {
    url: v.string(),
  },
  returns: v.union(cardReturnValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }

    return findDuplicateCardForUserHandler(ctx, user.subject, args.url);
  },
});

export const findDuplicateCardForUser = internalQuery({
  args: {
    userId: v.string(),
    url: v.string(),
  },
  returns: v.union(cardReturnValidator, v.null()),
  handler: async (ctx, args) => {
    return findDuplicateCardForUserHandler(ctx, args.userId, args.url);
  },
});
