import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

const AI_BACKFILL_BATCH_SIZE = 50;
const AI_BACKFILL_SCAN_PAGE_SIZE = 4 * AI_BACKFILL_BATCH_SIZE;
// Cap total index entries read per run so a long ineligible prefix cannot
// turn one backfill run into an unbounded scan.
const AI_BACKFILL_SCAN_BUDGET = 10 * AI_BACKFILL_SCAN_PAGE_SIZE;

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
    // cheap post-filters. Paginate until the batch is full so a page of
    // ineligible entries (deleted or partially processed cards) cannot starve
    // eligible ones behind it; the scan budget keeps each run bounded, and
    // the ineligible prefix drains as card cleanup removes deleted rows.
    const batch = [];
    let cursor: string | null = null;
    let scanned = 0;
    while (batch.length < AI_BACKFILL_BATCH_SIZE) {
      const page = await ctx.db
        .query("cards")
        .withIndex("by_aiSummary_created", (q) =>
          q.eq("aiSummary", undefined).lt("createdAt", fiveMinutesAgo)
        )
        .paginate({ cursor, numItems: AI_BACKFILL_SCAN_PAGE_SIZE });
      scanned += page.page.length;
      for (const card of page.page) {
        if (
          card.isDeleted !== true &&
          card.aiTags === undefined &&
          card.aiTranscript === undefined
        ) {
          batch.push({ cardId: card._id });
          if (batch.length >= AI_BACKFILL_BATCH_SIZE) {
            break;
          }
        }
      }
      if (page.isDone || scanned >= AI_BACKFILL_SCAN_BUDGET) {
        break;
      }
      cursor = page.continueCursor;
    }
    return batch; // Process in batches
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
