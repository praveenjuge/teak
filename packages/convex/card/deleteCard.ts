import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
} from "../_generated/server";
import { recordCardTombstone } from "../publicApiTombstones";
import {
  requireSessionUser,
  requireTeakUserId,
  type TeakUserId,
} from "../securitySessions";
import { cardStorageObjectKeys, queueObjectDeletion } from "../storage/r2";
import {
  ensureCardUsageShardsForRemoval,
  recordActiveCardRemoved,
} from "./cardUsage";
import { syncCardSearch } from "./searchDocumentHelpers";
import { updateCardFieldForUserHandler } from "./updateCard";

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

const permanentDeleteCardForUserHandler = async (
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

  await ctx.db.delete("cards", cardId);
  await recordCardTombstone(ctx, { cardId, userId: card.userId });
  if (!card.isDeleted) {
    await recordActiveCardRemoved(ctx, card.userId, cardId);
  }
  await syncCardSearch(ctx, cardId, card.userId, card);
  for (const key of cardStorageObjectKeys(card)) {
    await queueObjectDeletion(ctx, key);
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
