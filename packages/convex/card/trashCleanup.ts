import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { recordCardTombstone } from "../publicApiTombstones";
import { cardStorageObjectKeys, queueObjectDeletion } from "../storage/r2";
import { syncCardSearch } from "./searchSync";

const LOG_PREFIX = "[card/trashCleanup]";

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

    for (const key of cardStorageObjectKeys(card)) {
      try {
        await queueObjectDeletion(ctx, key);
      } catch (error) {
        console.error(`${LOG_PREFIX} Failed to delete object`, {
          cardId,
          key,
          error,
        });
      }
    }

    let deleted = false;
    try {
      await ctx.db.delete("cards", cardId);
      await recordCardTombstone(ctx, { cardId, userId: card.userId });
      await syncCardSearch(ctx, cardId, card.userId, card);
      deleted = true;
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to delete card record`, {
        cardId,
        error,
      });
    }

    return { deleted };
  },
});
