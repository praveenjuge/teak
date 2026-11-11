import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { deleteCardForever } from "./deleteCard";

export const getCardsPendingCleanup = internalQuery({
  args: {
    olderThan: v.number(),
    limit: v.number(),
  },
  returns: v.array(
    v.object({
      _id: v.id("cards"),
    })
  ),
  handler: async (ctx, { olderThan, limit }) => {
    const candidates = await ctx.db
      .query("cards")
      .withIndex("by_isDeleted_deletedAt", (q) =>
        q.eq("isDeleted", true).gte("deletedAt", 0).lt("deletedAt", olderThan)
      )
      .take(limit);

    return candidates.map((card) => ({
      _id: card._id,
    }));
  },
});

export const cleanupDeletedCard = internalMutation({
  args: {
    cardId: v.id("cards"),
    cutoff: v.number(),
  },
  returns: v.object({
    deleted: v.boolean(),
  }),
  handler: async (ctx, { cardId, cutoff }) => {
    const card = await ctx.db.get("cards", cardId);
    if (!card) {
      return { deleted: false };
    }

    const deletedAt =
      typeof card.deletedAt === "number" ? card.deletedAt : null;
    const isEligible =
      card.isDeleted === true && deletedAt !== null && deletedAt < cutoff;

    if (!isEligible) {
      return { deleted: false };
    }

    await deleteCardForever(ctx, card);
    return { deleted: true };
  },
});
