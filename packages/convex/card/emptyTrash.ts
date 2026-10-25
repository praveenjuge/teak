import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import {
  internalMutation,
  mutation,
  type QueryCtx,
  query,
} from "../_generated/server";
import {
  getSessionUser,
  requireSessionUser,
  requireTeakUserId,
} from "../securitySessions";
import { TRASH_COUNT_LIMIT } from "../shared/constants";
import { rateLimiter } from "../shared/rateLimits";
import { permanentDeleteCardForUserHandler } from "./deleteCard";

/** Cards hard-deleted per run; each run schedules the next. */
export const EMPTY_TRASH_PAGE_SIZE = 25;

export const EMPTY_TRASH_RATE_LIMITED_MESSAGE =
  "Trash was emptied a few times just now. Try again in a minute.";

const trashedCards = (ctx: QueryCtx, userId: string) =>
  ctx.db
    .query("cards")
    .withIndex("by_user_deleted_created", (q) =>
      q.eq("userId", userId).eq("isDeleted", true)
    );

/** Counts the account's Trash, hidden cards included, up to the limit. */
const countTrashedCards = async (ctx: QueryCtx, userId: string) => {
  let count = 0;
  for await (const _card of trashedCards(ctx, userId)) {
    count += 1;
    if (count >= TRASH_COUNT_LIMIT) {
      break;
    }
  }
  return count;
};

/** A card moved to Trash after Empty Trash started stays there. */
const trashedBefore = (card: Doc<"cards">, startedAt: number) =>
  card.isDeleted === true && (card.deletedAt ?? 0) <= startedAt;

/**
 * How many cards are in Trash, at most `TRASH_COUNT_LIMIT`: a count at the
 * limit means that many or more.
 */
export const trashCount = query({
  args: {},
  returns: v.object({ count: v.number() }),
  handler: async (ctx) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return { count: 0 };
    }
    return { count: await countTrashedCards(ctx, user.teakUserId) };
  },
});

/**
 * Permanently deletes every card in the account's Trash. It returns the
 * count (as `trashCount` does) and deletes them a page at a time after it
 * returns, skipping cards trashed after the call.
 */
export const emptyTrash = mutation({
  args: {},
  returns: v.object({ count: v.number() }),
  handler: async (ctx) => {
    const user = await requireSessionUser(ctx);
    const limited = await rateLimiter.limit(ctx, "emptyTrash", {
      key: user.teakUserId,
      throws: false,
    });
    if (!limited.ok) {
      throw new ConvexError({
        code: "RATE_LIMITED",
        message: EMPTY_TRASH_RATE_LIMITED_MESSAGE,
        retryAt: Date.now() + limited.retryAfter,
      });
    }
    const count = await countTrashedCards(ctx, user.teakUserId);
    if (count > 0) {
      await ctx.scheduler.runAfter(0, internal.card.emptyTrash.emptyTrashPage, {
        userId: user.teakUserId,
        startedAt: Date.now(),
        cursor: null,
      });
    }
    return { count };
  },
});

export const emptyTrashPage = internalMutation({
  args: {
    userId: v.string(),
    startedAt: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    const { page, isDone, continueCursor } = await trashedCards(
      ctx,
      userId
    ).paginate({ cursor: args.cursor, numItems: EMPTY_TRASH_PAGE_SIZE });
    for (const card of page) {
      if (trashedBefore(card, args.startedAt)) {
        await permanentDeleteCardForUserHandler(ctx, userId, card._id, {
          requireTrashed: true,
        });
      }
    }
    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.card.emptyTrash.emptyTrashPage, {
        ...args,
        cursor: continueCursor,
      });
    }
    return null;
  },
});
