/**
 * AI Backfill Workflow
 *
 * Schedules AI metadata generation for cards lacking results.
 * Runs in batches to avoid overwhelming the pipeline and reports failures.
 */

import { v } from "convex/values";
import type { RetryBehavior } from "@convex-dev/workpool";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { workflow } from "./manager";

//@ts-ignore
const internalWorkflow = internal as Record<string, any>;

const LOG_PREFIX = "[workflow/aiBackfill]";
const BATCH_SIZE = 50;
const START_PIPELINE_RETRY: RetryBehavior = {
  maxAttempts: 5,
  initialBackoffMs: 2000,
  base: 2,
};

export const aiBackfillWorkflow = workflow.define({
  args: {},
  returns: v.object({
    enqueuedCount: v.number(),
    failedCardIds: v.array(v.id("cards")),
  }),
  handler: async (step) => {
    console.info(`${LOG_PREFIX} Fetching cards missing AI metadata`, {
      batchSize: BATCH_SIZE,
    });

    const candidates: { cardId: Id<"cards"> }[] = await step.runQuery(
      internalWorkflow["ai/queries"].findCardsMissingAi,
      {}
    );

    if (candidates.length === 0) {
      console.info(`${LOG_PREFIX} No cards require backfill`);
      return {
        enqueuedCount: 0,
        failedCardIds: [],
      };
    }

    const failedCardIds: Id<"cards">[] = [];

    for (const { cardId } of candidates) {
      try {
        await step.runAction(
          internalWorkflow["workflows/aiMetadata"].startAiMetadataWorkflow,
          { cardId, startAsync: true },
          { retry: START_PIPELINE_RETRY },
        );
      } catch (error) {
        failedCardIds.push(cardId);
        console.error(`${LOG_PREFIX} Failed to start pipeline`, {
          cardId,
          error,
        });
      }
    }

    const enqueuedCount = candidates.length - failedCardIds.length;

    console.info(`${LOG_PREFIX} Batch complete`, {
      totalCandidates: candidates.length,
      enqueuedCount,
      failedCount: failedCardIds.length,
    });

    return {
      enqueuedCount,
      failedCardIds,
    };
  },
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
    const result = await workflow.start(
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
