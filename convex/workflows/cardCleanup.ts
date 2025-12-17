import { v } from "convex/values";
import { internalQuery, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { workflow } from "./manager";

const internalWorkflow = internal as Record<string, any>;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 10;
const WORKFLOW_LOG_PREFIX = "[workflow/cardCleanup]";

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
      .filter((q) =>
        q.and(
          q.eq(q.field("isDeleted"), true),
          q.neq(q.field("deletedAt"), undefined),
          q.lt(q.field("deletedAt"), olderThan)
        )
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

    const deletedAt = typeof card.deletedAt === "number" ? card.deletedAt : null;
    const isEligible =
      card.isDeleted === true && deletedAt !== null && deletedAt < cutoff;

    if (!isEligible) {
      return { deleted: false };
    }

    if (card.fileId) {
      try {
        await ctx.storage.delete(card.fileId);
      } catch (error) {
        console.error(`${WORKFLOW_LOG_PREFIX} Failed to delete file`, {
          cardId,
          fileId: card.fileId,
          error,
        });
      }
    }
    if (card.thumbnailId) {
      try {
        await ctx.storage.delete(card.thumbnailId);
      } catch (error) {
        console.error(`${WORKFLOW_LOG_PREFIX} Failed to delete thumbnail`, {
          cardId,
          thumbnailId: card.thumbnailId,
          error,
        });
      }
    }

    let deleted = false;
    try {
      await ctx.db.delete("cards", cardId);
      deleted = true;
    } catch (error) {
      console.error(`${WORKFLOW_LOG_PREFIX} Failed to delete card record`, {
        cardId,
        error,
      });
    }

    return { deleted };
  },
});

export const cardCleanupWorkflow = workflow.define({
  args: {},
  returns: v.object({
    cleanedCount: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (step) => {
    const cutoff = Date.now() - THIRTY_DAYS_MS;

    const candidates = await step.runQuery(
      internalWorkflow["workflows/cardCleanup"].getCardsPendingCleanup,
      { olderThan: cutoff, limit: BATCH_SIZE }
    );

    if (candidates.length === 0) {
      return { cleanedCount: 0, hasMore: false };
    }

    let cleanedCount = 0;

    for (const candidate of candidates) {
      const result = await step.runMutation(
        internalWorkflow["workflows/cardCleanup"].cleanupDeletedCard,
        {
          cardId: candidate._id,
          cutoff,
        }
      );

      if (result.deleted) {
        cleanedCount += 1;
      }
    }

    const hasMore = candidates.length === BATCH_SIZE;

    if (hasMore) {
      await step.runMutation(
        internalWorkflow["workflows/cardCleanup"].startCardCleanupWorkflow,
        { startAsync: true }
      );
    }

    if (cleanedCount > 0) {
      console.info(`${WORKFLOW_LOG_PREFIX} Cleaned ${cleanedCount} cards`);
    }

    return {
      cleanedCount,
      hasMore,
    };
  },
});

export const startCardCleanupWorkflow = internalMutation({
  args: {
    startAsync: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({
      workflowId: v.string(),
    }),
    v.object({
      cleanedCount: v.number(),
      hasMore: v.boolean(),
    })
  ),
  handler: async (ctx, { startAsync }) => {
    const result = await workflow.start(
      ctx,
      internalWorkflow["workflows/cardCleanup"].cardCleanupWorkflow,
      {},
      { startAsync: startAsync ?? true }
    );

    if (typeof result === "string") {
      return { workflowId: result };
    }

    return result;
  },
});
