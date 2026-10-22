import { v } from "convex/values";
import { internalQuery, type QueryCtx, query } from "../_generated/server";
import {
  getSessionUser,
  requireTeakUserId,
  type TeakUserId,
} from "../securitySessions";
import { cardReturnValidator } from "./getCards";
import { attachCardDetailUrls } from "./queryUtils";

export const findDuplicateCardForUserHandler = async (
  ctx: Pick<QueryCtx, "db">,
  userId: TeakUserId,
  url: string
) => {
  const duplicate = await ctx.db
    .query("cards")
    .withIndex("by_user_url_deleted", (q) =>
      q.eq("userId", userId).eq("url", url).eq("isDeleted", undefined)
    )
    .order("desc")
    .first();

  if (!duplicate) {
    return null;
  }

  return await attachCardDetailUrls(ctx, duplicate);
};

export const findDuplicateCard = query({
  args: {
    url: v.string(),
  },
  returns: v.union(cardReturnValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return null;
    }

    return findDuplicateCardForUserHandler(ctx, user.teakUserId, args.url);
  },
});

export const findDuplicateCardForUser = internalQuery({
  args: {
    userId: v.string(),
    url: v.string(),
  },
  returns: v.union(cardReturnValidator, v.null()),
  handler: async (ctx, args) =>
    findDuplicateCardForUserHandler(
      ctx,
      await requireTeakUserId(ctx, args.userId),
      args.url
    ),
});
