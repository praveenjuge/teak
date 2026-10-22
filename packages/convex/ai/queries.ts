import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../_generated/server";

const AI_BACKFILL_BATCH_SIZE = 50;
const AI_BACKFILL_GRACE_MS = 5 * 60 * 1000;
const AI_BACKFILL_LEGACY_SCAN = 500;

/** No AI summary, tags or transcript yet: what `aiPending` marks. */
export const cardNeedsAiMetadata = (
  card: Pick<
    Doc<"cards">,
    "aiSummary" | "aiTags" | "aiTranscript" | "aiTranscriptCharCount"
  >
): boolean =>
  card.aiSummary === undefined &&
  card.aiTags === undefined &&
  card.aiTranscript === undefined &&
  card.aiTranscriptCharCount === undefined;

export const getCardForAI = internalQuery({
  args: { cardId: v.id("cards") },
  handler: async (ctx, { cardId }) => await ctx.db.get("cards", cardId),
});

export const findCardsMissingAiCandidates = async (
  ctx: QueryCtx
): Promise<{ cardId: Id<"cards"> }[]> => {
  const createdBefore = Date.now() - AI_BACKFILL_GRACE_MS;
  const found = new Map<Id<"cards">, Doc<"cards">>();

  for (const isDeleted of [undefined, false]) {
    const limit = AI_BACKFILL_BATCH_SIZE - found.size;
    if (limit <= 0) {
      break;
    }
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_aiPending_and_isDeleted_and_createdAt", (q) =>
        q
          .eq("aiPending", true)
          .eq("isDeleted", isDeleted)
          .lt("createdAt", createdBefore)
      )
      .take(limit);
    for (const card of cards) {
      found.set(card._id, card);
    }
  }

  // Cards saved before `aiPending` existed have no flag until
  // `backfillAiPending` runs, so the old index still finds them. Its range
  // also holds cards whose transcript moved off the card, so read past those
  // within a budget instead of letting them fill the batch.
  let legacyRowsRead = 0;
  for (const isDeleted of [undefined, false]) {
    const legacy = ctx.db
      .query("cards")
      .withIndex("by_aiSummary_aiTags_aiTranscript_isDeleted_createdAt", (q) =>
        q
          .eq("aiSummary", undefined)
          .eq("aiTags", undefined)
          .eq("aiTranscript", undefined)
          .eq("isDeleted", isDeleted)
          .lt("createdAt", createdBefore)
      );
    for await (const card of legacy) {
      if (
        found.size >= AI_BACKFILL_BATCH_SIZE ||
        legacyRowsRead >= AI_BACKFILL_LEGACY_SCAN
      ) {
        break;
      }
      legacyRowsRead += 1;
      if (cardNeedsAiMetadata(card)) {
        found.set(card._id, card);
      }
    }
  }

  return [...found.keys()].map((cardId) => ({ cardId }));
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
