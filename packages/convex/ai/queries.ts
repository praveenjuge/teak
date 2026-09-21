import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

const AI_BACKFILL_BATCH_SIZE = 50;
const AI_BACKFILL_INDEX =
  "by_aiSummary_aiTags_aiTranscript_isDeleted_createdAt" as const;

// Internal query to get card data for AI processing
export const getCardForAI = internalQuery({
  args: { cardId: v.id("cards") },
  handler: async (ctx, { cardId }) => await ctx.db.get("cards", cardId),
});

// Internal query to find cards missing AI metadata
export const findCardsMissingAi = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Find cards that don't have AI metadata (created more than 5 minutes ago to avoid race conditions)
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    // Query both active-card representations directly through the compound
    // index. This keeps reads bounded without repeatedly restarting behind a
    // persistent prefix of deleted or partially processed cards.
    const findActiveCards = async (
      isDeleted: boolean | undefined,
      limit: number
    ) =>
      await ctx.db
        .query("cards")
        .withIndex(AI_BACKFILL_INDEX, (q) =>
          q
            .eq("aiSummary", undefined)
            .eq("aiTags", undefined)
            .eq("aiTranscript", undefined)
            .eq("isDeleted", isDeleted)
            .lt("createdAt", fiveMinutesAgo)
        )
        .take(limit);

    const cardsWithUnsetDeletedFlag = await findActiveCards(
      undefined,
      AI_BACKFILL_BATCH_SIZE
    );
    const remaining = AI_BACKFILL_BATCH_SIZE - cardsWithUnsetDeletedFlag.length;
    const cardsWithFalseDeletedFlag =
      remaining > 0 ? await findActiveCards(false, remaining) : [];

    return [...cardsWithUnsetDeletedFlag, ...cardsWithFalseDeletedFlag].map(
      (card) => ({ cardId: card._id })
    );
  },
});

// Internal query to get card for verification
export const getCardForVerification = internalQuery({
  args: { cardId: v.id("cards"), userId: v.string() },
  handler: async (ctx, { cardId, userId }) => {
    const card = await ctx.db.get("cards", cardId);
    if (!card || card.userId !== userId) {
      return null;
    }
    return { exists: true };
  },
});
