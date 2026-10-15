import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { stageFailed } from "../card/processingStatus";
import { patchCardWithSearchSync } from "../card/searchDocumentHelpers";
import type { Id } from "../shared/types";
import { startWorkflow, workflow } from "./manager";

// The backfill runs every 6 hours, so a card gets about a day of retries.
export const MAX_AI_BACKFILL_ATTEMPTS = 4;

const internalWorkflow = internal as Record<string, any>;
const aiMetadataInternal = internalWorkflow["workflows/aiMetadata/index"] as
  | Record<string, any>
  | undefined;

const LOG_PREFIX = "[workflow/aiBackfill]";

export const aiBackfillWorkflow = workflow.define({
  args: {},
  returns: v.object({
    enqueuedCount: v.number(),
    failedCardIds: v.array(v.id("cards")),
  }),
  handler: async (step) => {
    const candidates: { cardId: Id<"cards"> }[] = await step.runQuery(
      internalWorkflow["ai/queries"].findCardsMissingAi,
      {}
    );

    if (candidates.length === 0) {
      return {
        enqueuedCount: 0,
        failedCardIds: [],
      };
    }

    const failedCardIds: Id<"cards">[] = [];

    if (!aiMetadataInternal) {
      throw new Error(
        "AI metadata workflow handle not found (expected internal.workflows/aiMetadata/index)"
      );
    }

    let enqueuedCount = 0;
    for (const { cardId } of candidates) {
      try {
        const outcome = await step.runMutation(
          internalWorkflow["workflows/aiBackfill"].enqueueAiBackfillCard,
          { cardId }
        );
        if (outcome === "enqueued") {
          enqueuedCount += 1;
        } else if (outcome === "exhausted") {
          console.warn(`${LOG_PREFIX} Gave up after repeated failures`, {
            cardId,
          });
        }
      } catch (error) {
        failedCardIds.push(cardId);
        console.error(`${LOG_PREFIX} Failed to start pipeline`, {
          cardId,
          error,
        });
      }
    }

    if (enqueuedCount > 0) {
      console.info(`${LOG_PREFIX} Enqueued ${enqueuedCount} cards`);
    }

    return {
      enqueuedCount,
      failedCardIds,
    };
  },
});

export const enqueueAiBackfillCardHandler = async (
  ctx: MutationCtx,
  cardId: Id<"cards">
): Promise<"enqueued" | "exhausted" | "skipped"> => {
  const card = await ctx.db.get("cards", cardId);
  if (
    !card ||
    card.isDeleted === true ||
    card.aiSummary !== undefined ||
    card.aiTags !== undefined ||
    card.aiTranscript !== undefined
  ) {
    return "skipped";
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
    return "exhausted";
  }
  if (!aiMetadataInternal) {
    throw new Error(
      "AI metadata workflow handle not found (expected internal.workflows/aiMetadata/index)"
    );
  }
  await ctx.db.patch("cards", cardId, { aiBackfillAttempts: attempts + 1 });
  await startWorkflow(
    ctx,
    aiMetadataInternal.aiMetadataWorkflow,
    { cardId },
    { startAsync: true }
  );
  return "enqueued";
};

/**
 * Count one backfill attempt for a card and start its AI metadata workflow,
 * or, once the card has used every attempt, stop retrying it.
 */
export const enqueueAiBackfillCard = internalMutation({
  args: { cardId: v.id("cards") },
  returns: v.union(
    v.literal("enqueued"),
    v.literal("exhausted"),
    v.literal("skipped")
  ),
  handler: (ctx, { cardId }) => enqueueAiBackfillCardHandler(ctx, cardId),
});

export const startAiBackfillWorkflow = internalMutation({
  args: {
    startAsync: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({
      workflowId: v.string(),
    }),
    v.object({
      enqueuedCount: v.number(),
      failedCardIds: v.array(v.id("cards")),
    })
  ),
  handler: async (ctx, { startAsync }) => {
    const result = await startWorkflow(
      ctx,
      internalWorkflow["workflows/aiBackfill"].aiBackfillWorkflow,
      {},
      { startAsync: startAsync ?? true }
    );

    if (typeof result === "string") {
      return { workflowId: result };
    }

    return result;
  },
});
