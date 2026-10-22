import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../_generated/server";

const AI_BACKFILL_BATCH_SIZE = 50;
const AI_BACKFILL_GRACE_MS = 5 * 60 * 1000;

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

  const findActiveCards = async (
    isDeleted: boolean | undefined,
    limit: number
  ) =>
    await ctx.db
      .query("cards")
      .withIndex("by_aiPending_and_isDeleted_and_createdAt", (q) =>
        q
          .eq("aiPending", true)
          .eq("isDeleted", isDeleted)
          .lt("createdAt", createdBefore)
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
