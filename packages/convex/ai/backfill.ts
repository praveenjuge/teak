import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { stageFailed } from "../card/processingStatus";
import { patchCardWithSearchSync } from "../card/searchDocumentHelpers";
import { queueCardProcessing } from "../workflowDispatch";
import { findCardsMissingAiCandidates } from "./queries";

export const AI_BACKFILL_INTERVAL_HOURS = 6;
const AI_BACKFILL_RETRY_WINDOW_HOURS = 24;
export const MAX_AI_BACKFILL_ATTEMPTS =
  AI_BACKFILL_RETRY_WINDOW_HOURS / AI_BACKFILL_INTERVAL_HOURS;

export type AiBackfillClaim =
  | { outcome: "claimed"; rev: number }
  | { outcome: "exhausted" | "skipped" };

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
