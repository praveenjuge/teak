import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { stageFailed } from "../card/processingStatus";
import { patchCardWithSearchSync } from "../card/searchDocumentHelpers";
import { queueCardProcessing } from "../workflowDispatch";
import { findCardsMissingAiCandidates } from "./queries";

// The Files Worker's AI backfill queue (apps/files-worker/src/queues/
// aiBackfill.ts) regenerates AI metadata for cards whose first run deferred
// it. Every 6 hours it claims a batch here; each claim counts one attempt.

export const AI_BACKFILL_INTERVAL_HOURS = 6;
const AI_BACKFILL_RETRY_WINDOW_HOURS = 24;
export const MAX_AI_BACKFILL_ATTEMPTS =
  AI_BACKFILL_RETRY_WINDOW_HOURS / AI_BACKFILL_INTERVAL_HOURS;

export type AiBackfillClaim =
  | { outcome: "claimed"; rev: number }
  | { outcome: "exhausted" | "skipped" };

/**
 * Counts one backfill attempt for a card, or, once the card has used every
 * attempt, stops retrying it. A claimed card carries its processing
 * revision, so the backfill's writes stop if the card is edited meanwhile.
 */
export const claimAiBackfillCard = async (
  ctx: MutationCtx,
  cardId: Id<"cards">
): Promise<AiBackfillClaim> => {
  const card = await ctx.db.get("cards", cardId);
  if (
    !card ||
    card.isDeleted === true ||
    card.aiSummary !== undefined ||
    card.aiTags !== undefined ||
    card.aiTranscript !== undefined
  ) {
    return { outcome: "skipped" };
  }
  const attempts = card.aiBackfillAttempts ?? 0;
  const now = Date.now();
  if (attempts >= MAX_AI_BACKFILL_ATTEMPTS) {
    await patchCardWithSearchSync(ctx, cardId, {
      aiTags: [],
      processingStatus: {
        ...(card.processingStatus ?? {}),
        metadata: stageFailed(
          now,
          "ai_backfill_exhausted",
          card.processingStatus?.metadata
        ),
      },
      updatedAt: now,
    });
    return { outcome: "exhausted" };
  }
  await ctx.db.patch("cards", cardId, { aiBackfillAttempts: attempts + 1 });
  return { outcome: "claimed", rev: card.processingRev ?? 0 };
};

/** The cards one backfill run should regenerate AI metadata for. */
export const claimAiBackfillCards = internalMutation({
  args: {},
  returns: v.object({
    cards: v.array(v.object({ cardId: v.id("cards"), rev: v.number() })),
    exhausted: v.number(),
  }),
  handler: async (ctx) => {
    const cards: { cardId: Id<"cards">; rev: number }[] = [];
    let exhausted = 0;
    for (const { cardId } of await findCardsMissingAiCandidates(ctx)) {
      const claim = await claimAiBackfillCard(ctx, cardId);
      if (claim.outcome === "claimed") {
        cards.push({ cardId, rev: claim.rev });
      } else if (claim.outcome === "exhausted") {
        exhausted += 1;
        console.warn("[ai/backfill] Gave up after repeated failures", {
          cardId,
        });
      }
    }
    return { cards, exhausted };
  },
});

/**
 * Gives back the attempts a claim counted when the Worker could not queue
 * the cards, so an attempt is only spent on a card that was queued.
 */
export const releaseAiBackfillCards = internalMutation({
  args: { cardIds: v.array(v.id("cards")) },
  returns: v.null(),
  handler: async (ctx, { cardIds }) => {
    for (const cardId of cardIds) {
      const card = await ctx.db.get("cards", cardId);
      const attempts = card?.aiBackfillAttempts ?? 0;
      if (attempts > 0) {
        await ctx.db.patch("cards", cardId, {
          aiBackfillAttempts: attempts - 1,
        });
      }
    }
    return null;
  },
});

/**
 * The admin console's "retry AI backfill": claims a batch now and starts a
 * metadata-only card-processing run for each claimed card, which
 * regenerates its AI metadata and leaves every other stage as it is.
 */
export const retryAiBackfillNow = internalMutation({
  args: {},
  returns: v.object({
    enqueuedCount: v.number(),
    failedCardIds: v.array(v.id("cards")),
  }),
  handler: async (ctx) => {
    let enqueuedCount = 0;
    const failedCardIds: Id<"cards">[] = [];
    for (const { cardId } of await findCardsMissingAiCandidates(ctx)) {
      const claim = await claimAiBackfillCard(ctx, cardId);
      if (claim.outcome !== "claimed") {
        continue;
      }
      if (await queueCardProcessing(ctx, cardId, { metadataOnly: true })) {
        enqueuedCount += 1;
      } else {
        failedCardIds.push(cardId);
      }
    }
    return { enqueuedCount, failedCardIds };
  },
});
