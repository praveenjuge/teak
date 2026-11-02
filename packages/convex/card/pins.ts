import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "../_generated/server";
import {
  getSessionUser,
  requireSessionUser,
  type TeakUserId,
} from "../securitySessions";
import {
  MAX_PINNED_CARDS,
  PIN_ERROR_CODES,
  PIN_ERROR_MESSAGES,
} from "../shared/pins";
import { cardReturnValidator } from "./getCards";
import { keepVisible } from "./hiddenCards";
import { attachFileUrls } from "./queryUtils";
import { applyQuoteFormattingToList } from "./quoteFormatting";

/**
 * A person's pinned cards, first to last. Archiving or trashing a card
 * unpins it, so every row here is an active card. The cap keeps the read
 * at most one row past it.
 */
export const readPinnedCards = async (
  ctx: QueryCtx,
  userId: TeakUserId
): Promise<Doc<"cards">[]> =>
  await ctx.db
    .query("cards")
    .withIndex("by_user_pin_position", (q) =>
      q.eq("userId", userId).gte("pinPosition", Number.NEGATIVE_INFINITY)
    )
    .take(MAX_PINNED_CARDS + 1);

const notFound = () =>
  new ConvexError({ code: "NOT_FOUND", message: "Card not found" });

export const setCardPinnedForUser = async (
  ctx: MutationCtx,
  {
    userId,
    cardId,
    pinned,
  }: { cardId: Id<"cards">; pinned: boolean; userId: TeakUserId }
): Promise<{ changed: boolean }> => {
  const card = await ctx.db.get("cards", cardId);
  if (!card || card.userId !== userId) {
    throw notFound();
  }
  if ((card.pinPosition !== undefined) === pinned) {
    return { changed: false };
  }
  if (!pinned) {
    await ctx.db.patch("cards", cardId, {
      pinPosition: undefined,
      updatedAt: Date.now(),
    });
    return { changed: true };
  }
  if (card.isDeleted || card.isArchived) {
    throw new ConvexError({
      code: "CONFLICT",
      message: PIN_ERROR_MESSAGES.ARCHIVED,
    });
  }
  const pins = await readPinnedCards(ctx, userId);
  if (pins.length >= MAX_PINNED_CARDS) {
    throw new ConvexError({
      code: PIN_ERROR_CODES.PIN_LIMIT_REACHED,
      message: PIN_ERROR_MESSAGES.PIN_LIMIT_REACHED,
      limit: MAX_PINNED_CARDS,
    });
  }
  // A new pin goes first.
  const first = pins[0]?.pinPosition;
  await ctx.db.patch("cards", cardId, {
    pinPosition: first === undefined ? 0 : first - 1,
    updatedAt: Date.now(),
  });
  return { changed: true };
};

/**
 * Puts the pinned cards in the given order. `cardIds` must name every
 * pinned card exactly once, so a stale list can't drop or revive a pin.
 */
export const reorderPinnedCardsForUser = async (
  ctx: MutationCtx,
  { userId, cardIds }: { cardIds: readonly string[]; userId: TeakUserId }
): Promise<Doc<"cards">[]> => {
  const pins = await readPinnedCards(ctx, userId);
  const byId = new Map(pins.map((card) => [card._id as string, card]));
  const unique = new Set(cardIds);
  if (
    unique.size !== cardIds.length ||
    cardIds.length !== pins.length ||
    cardIds.some((id) => !byId.has(id))
  ) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: PIN_ERROR_MESSAGES.ORDER_MISMATCH,
    });
  }
  const now = Date.now();
  const ordered: Doc<"cards">[] = [];
  for (const [index, id] of cardIds.entries()) {
    const card = byId.get(id) as Doc<"cards">;
    // Only cards that moved are written, so a reorder conflicts with as
    // few concurrent card writes as possible.
    if (card.pinPosition !== index) {
      await ctx.db.patch("cards", card._id, {
        pinPosition: index,
        updatedAt: now,
      });
    }
    ordered.push({ ...card, pinPosition: index });
  }
  return ordered;
};

export const setCardPinned = mutation({
  args: { cardId: v.id("cards"), pinned: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { cardId, pinned }) => {
    const user = await requireSessionUser(ctx);
    await setCardPinnedForUser(ctx, {
      userId: user.teakUserId,
      cardId,
      pinned,
    });
    return null;
  },
});

export const reorderPinnedCards = mutation({
  args: { cardIds: v.array(v.id("cards")) },
  returns: v.null(),
  handler: async (ctx, { cardIds }) => {
    const user = await requireSessionUser(ctx);
    await reorderPinnedCardsForUser(ctx, {
      userId: user.teakUserId,
      cardIds,
    });
    return null;
  },
});

export const getPinnedCards = query({
  args: {},
  returns: v.array(cardReturnValidator),
  handler: async (ctx) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return [];
    }
    const cards = keepVisible(await readPinnedCards(ctx, user.teakUserId));
    return applyQuoteFormattingToList(await attachFileUrls(ctx, cards));
  },
});
