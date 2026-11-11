import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
} from "../_generated/server";
import { deleteCardFolderRuleRows } from "../folder/rules";
import { recordCardTombstone } from "../publicApiTombstones";
import {
  requireSessionUser,
  requireTeakUserId,
  type TeakUserId,
} from "../securitySessions";
import { cardStorageObjectKeys } from "../storage/cardObjectKeys";
import { queueObjectDeletion } from "../storage/objectDeletion";
import {
  ensureCardUsageShardsForRemoval,
  recordActiveCardRemoved,
} from "./cardUsage";
import { onCardChanged } from "./onCardChanged";
import { updateCardFieldForUserHandler } from "./updateCard";

/**
 * Deletes a card and everything kept for it: its folder-rule rows, derived
 * rows (through `onCardChanged`) and stored objects, leaving a tombstone for
 * API sync. The caller keeps the free plan's count. Any failure throws, so
 * the transaction never commits half a delete.
 */
export const deleteCardForever = async (
  ctx: MutationCtx,
  card: Doc<"cards">
) => {
  await ctx.db.delete("cards", card._id);
  await deleteCardFolderRuleRows(ctx, card._id);
  await recordCardTombstone(ctx, { cardId: card._id, userId: card.userId });
  await onCardChanged(ctx, card._id, card.userId, card);
  await queueObjectDeletion(ctx, cardStorageObjectKeys(card));
};

export const permanentDeleteCard = mutation({
  args: {
    id: v.id("cards"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireSessionUser(ctx);

    await permanentDeleteCardForUserHandler(ctx, user.teakUserId, args.id);

    return null;
  },
});

export const permanentDeleteCardForUserHandler = async (
  ctx: MutationCtx,
  userId: TeakUserId,
  cardId: Id<"cards">,
  options: { requireTrashed?: boolean } = {}
) => {
  const card = await ctx.db.get("cards", cardId);

  if (!card) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Card not found" });
  }

  if (card.userId !== userId) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Not authorized to permanently delete this card",
    });
  }

  if (options.requireTrashed && !card.isDeleted) {
    throw new ConvexError({
      code: "NOT_IN_TRASH",
      message: "Move the card to Trash before deleting it permanently",
    });
  }

  if (!card.isDeleted) {
    await ensureCardUsageShardsForRemoval(ctx, card.userId);
  }

  await deleteCardForever(ctx, card);
  if (!card.isDeleted) {
    await recordActiveCardRemoved(ctx, card.userId, cardId);
  }
};

export const permanentDeleteCardForUser = internalMutation({
  args: { cardId: v.id("cards"), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await permanentDeleteCardForUserHandler(
      ctx,
      await requireTeakUserId(ctx, args.userId),
      args.cardId,
      { requireTrashed: true }
    );
    return null;
  },
});

export const restoreCardForUser = internalMutation({
  args: { cardId: v.id("cards"), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    const card = await ctx.db.get("cards", args.cardId);
    if (!card) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Card not found" });
    }
    if (card.userId !== userId) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Not authorized to restore this card",
      });
    }
    if (!card.isDeleted) {
      return null;
    }
    await updateCardFieldForUserHandler(ctx, {
      ...args,
      userId,
      field: "restore",
    });
    return null;
  },
});
