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

/** Cards listed per run; each run schedules their deletes and the next run. */
export const EMPTY_TRASH_PAGE_SIZE = 25;

/**
 * Bytes one count or one listing run may read. A note can hold 512 KiB, so a
 * page stops early on large cards and stays far below Convex's 16 MiB limit.
 */
const COUNT_BYTES = 8 * 1024 * 1024;
const PAGE_BYTES = 4 * 1024 * 1024;

export const EMPTY_TRASH_RATE_LIMITED_MESSAGE =
  "Trash was emptied a few times just now. Try again in a minute.";

const trashedCards = (ctx: QueryCtx, userId: string) =>
  ctx.db
    .query("cards")
    .withIndex("by_user_deleted_created", (q) =>
      q.eq("userId", userId).eq("isDeleted", true)
    );

/**
 * Counts the account's Trash, hidden cards included, reading at most
 * `TRASH_COUNT_LIMIT` cards and `COUNT_BYTES`. `more` is true when Trash holds
 * cards past the ones counted, so the count means "this many or more".
 */
const countTrashedCards = async (ctx: QueryCtx, userId: string) => {
  const { page, isDone } = await trashedCards(ctx, userId).paginate({
    cursor: null,
    numItems: TRASH_COUNT_LIMIT,
    maximumBytesRead: COUNT_BYTES,
  });
  return { count: page.length, more: !isDone };
};

/** A card moved to Trash after Empty Trash started stays there. */
const trashedBefore = (card: Doc<"cards">, startedAt: number) =>
  card.isDeleted === true && (card.deletedAt ?? 0) <= startedAt;

const trashCountValidator = v.object({ count: v.number(), more: v.boolean() });

/**
 * How many cards are in Trash. When `more` is true there are more than
 * `count`, and a confirmation says "this many or more".
 */
export const trashCount = query({
  args: {},
  returns: trashCountValidator,
  handler: async (ctx) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return { count: 0, more: false };
    }
    return await countTrashedCards(ctx, user.teakUserId);
  },
});

/**
 * Permanently deletes every card in the account's Trash. It returns the
 * count (as `trashCount` does) and deletes them after it returns, skipping
 * cards trashed after the call.
 */
export const emptyTrash = mutation({
  args: {},
  returns: trashCountValidator,
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
    const trash = await countTrashedCards(ctx, user.teakUserId);
    if (trash.count > 0) {
      await ctx.scheduler.runAfter(0, internal.card.emptyTrash.emptyTrashPage, {
        userId: user.teakUserId,
        startedAt: Date.now(),
        cursor: null,
      });
    }
    return trash;
  },
});

/**
 * Lists a page of Trash and schedules one delete per card. Deleting a card
 * also reads its search row and transcript, so each gets its own transaction.
 */
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
    ).paginate({
      cursor: args.cursor,
      numItems: EMPTY_TRASH_PAGE_SIZE,
      maximumBytesRead: PAGE_BYTES,
    });
    for (const card of page) {
      if (trashedBefore(card, args.startedAt)) {
        await ctx.scheduler.runAfter(
          0,
          internal.card.emptyTrash.emptyTrashCard,
          {
            userId,
            startedAt: args.startedAt,
            cardId: card._id,
          }
        );
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

/** Deletes one card, unless it was deleted, restored or trashed again since. */
export const emptyTrashCard = internalMutation({
  args: { userId: v.string(), startedAt: v.number(), cardId: v.id("cards") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    const card = await ctx.db.get("cards", args.cardId);
    if (card?.userId === userId && trashedBefore(card, args.startedAt)) {
      await permanentDeleteCardForUserHandler(ctx, userId, card._id, {
        requireTrashed: true,
      });
    }
    return null;
  },
});
