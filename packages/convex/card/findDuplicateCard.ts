import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalQuery, type QueryCtx, query } from "../_generated/server";
import {
  getSessionUser,
  requireTeakUserId,
  type TeakUserId,
} from "../securitySessions";
import { urlKey } from "../shared/utils/urlKey";
import { cardReturnValidator } from "./getCards";
import { attachCardDetailUrls } from "./queryUtils";

/**
 * The newest card outside Trash saved from the same link as `url`, ignoring
 * the differences `urlKey` ignores. Archived cards count.
 */
export const findLiveCardByUrl = async (
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  url: string
): Promise<Doc<"cards"> | null> => {
  const key = urlKey(url);
  const [byKey, byExactUrl] = await Promise.all([
    key
      ? ctx.db
          .query("cards")
          .withIndex("by_user_urlkey_deleted", (q) =>
            q.eq("userId", userId).eq("urlKey", key).eq("isDeleted", undefined)
          )
          .order("desc")
          .first()
      : null,
    // Finds a card without a `urlKey` by its exact address. The production
    // backfill keyed every card; this stays until a later PR drops it
    // (`.agents/records/sunset.md`).
    ctx.db
      .query("cards")
      .withIndex("by_user_url_deleted", (q) =>
        q.eq("userId", userId).eq("url", url).eq("isDeleted", undefined)
      )
      .order("desc")
      .first(),
  ]);
  if (!(byKey && byExactUrl)) {
    return byKey ?? byExactUrl;
  }
  return byKey._creationTime >= byExactUrl._creationTime ? byKey : byExactUrl;
};

export const findDuplicateCardForUserHandler = async (
  ctx: Pick<QueryCtx, "db">,
  userId: TeakUserId,
  url: string
) => {
  const duplicate = await findLiveCardByUrl(ctx, userId, url);

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
