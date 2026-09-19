import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

const AI_BACKFILL_BATCH_SIZE = 50;
const AI_BACKFILL_SCAN_PAGE_SIZE = 4 * AI_BACKFILL_BATCH_SIZE;

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

    // Bound the scan with the by_aiSummary_created index: cards without a
    // summary are a small subset, so reads stay proportional to the backlog
    // instead of scanning the whole table on every backfill run. The index
    // range applies the age cutoff; deletion and the remaining AI fields are
    // cheap post-filters on an over-fetched page. Cards beyond the page are
    // picked up by the next scheduled run.
    const candidates = await ctx.db
      .query("cards")
      .withIndex("by_aiSummary_created", (q) =>
        q.eq("aiSummary", undefined).lt("createdAt", fiveMinutesAgo)
      )
      .take(AI_BACKFILL_SCAN_PAGE_SIZE);

    return candidates
      .filter(
        (card) =>
          card.isDeleted !== true &&
          card.aiTags === undefined &&
          card.aiTranscript === undefined
      )
      .slice(0, AI_BACKFILL_BATCH_SIZE) // Process in batches
      .map((card) => ({ cardId: card._id }));
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
