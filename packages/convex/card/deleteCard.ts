import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
} from "../_generated/server";
import {
  getSessionUser,
  requireTeakUserId,
  type TeakUserId,
} from "../securitySessions";
import { cardStorageObjectKeys, deleteObject } from "../storage/r2";
import {
  ensureCardUsageShardsForRemoval,
  recordActiveCardRemoved,
} from "./cardUsage";
import { scheduleCardSearchSync } from "./searchDocumentHelpers";
import { updateCardFieldForUserHandler } from "./updateCard";

export const permanentDeleteCard = mutation({
  args: {
    id: v.id("cards"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      throw new Error("User must be authenticated");
    }

    await permanentDeleteCardForUserHandler(ctx, user.teakUserId, args.id);

    return null;
  },
});

const permanentDeleteCardForUserHandler = async (
  ctx: MutationCtx,
  userId: TeakUserId,
  cardId: Id<"cards">
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

  if (!card.isDeleted) {
    await ensureCardUsageShardsForRemoval(ctx, card.userId);
  }

  // Permanently remove from database
  await ctx.db.delete("cards", cardId);
  if (!card.isDeleted) {
    await recordActiveCardRemoved(ctx, card.userId, cardId);
  }
  await scheduleCardSearchSync(ctx, cardId, card.userId);
  for (const key of cardStorageObjectKeys(card)) {
    await deleteObject(ctx, key);
  }
};

export const permanentDeleteCardForUser = internalMutation({
  args: { cardId: v.id("cards"), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await permanentDeleteCardForUserHandler(
      ctx,
      await requireTeakUserId(ctx, args.userId),
      args.cardId
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
    // A lost response can make clients retry a successful restore.
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
