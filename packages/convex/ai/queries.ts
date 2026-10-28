import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion";

const AI_BACKFILL_BATCH_SIZE = 50;
const AI_BACKFILL_GRACE_MS = 5 * 60 * 1000;

/** No AI summary, tags or transcript yet: what `aiPending` marks. */
export const cardNeedsAiMetadata = (
  card: Pick<Doc<"cards">, "aiSummary" | "aiTags" | "aiTranscriptCharCount">
): boolean =>
  card.aiSummary === undefined &&
  card.aiTags === undefined &&
  card.aiTranscriptCharCount === undefined;

export const getCardForAI = internalQuery({
  args: { cardId: v.id("cards") },
  handler: async (ctx, { cardId }) => await ctx.db.get("cards", cardId),
});

/**
 * Most pending cards each pass reads to fill a batch. Cards whose account
 * deletion owns their rows are skipped (writes to them are no-ops), so a
 * stalled deletion with many pending cards can't pin the batch to its oldest
 * cards; the budget keeps that walk bounded.
 */
export const AI_BACKFILL_SCAN_LIMIT = 5 * AI_BACKFILL_BATCH_SIZE;

export const findCardsMissingAiCandidates = async (
  ctx: QueryCtx
): Promise<{ cardId: Id<"cards"> }[]> => {
  const createdBefore = Date.now() - AI_BACKFILL_GRACE_MS;
  const deletionOwnsRows = createAccountDeletionGate(ctx);
  const found: Id<"cards">[] = [];

  for (const isDeleted of [undefined, false]) {
    if (found.length >= AI_BACKFILL_BATCH_SIZE) {
      break;
    }
    let read = 0;
    for await (const card of ctx.db
      .query("cards")
      .withIndex("by_aiPending_and_isDeleted_and_createdAt", (q) =>
        q
          .eq("aiPending", true)
          .eq("isDeleted", isDeleted)
          .lt("createdAt", createdBefore)
      )) {
      read += 1;
      if (!(await deletionOwnsRows(card.userId))) {
        found.push(card._id);
      }
      if (
        found.length >= AI_BACKFILL_BATCH_SIZE ||
        read >= AI_BACKFILL_SCAN_LIMIT
      ) {
        break;
      }
    }
  }

  return found.map((cardId) => ({ cardId }));
};

export const findCardsMissingAi = internalQuery({
  args: {},
  handler: (ctx) => findCardsMissingAiCandidates(ctx),
});

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
