/**
 * AI Backfill Workflow
 *
 * Schedules AI metadata generation for cards lacking results.
 * Runs in batches to avoid overwhelming the pipeline and reports failures.
 */

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import type { Id } from "../shared/types";
import { workflow } from "./manager";

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

    for (const { cardId } of candidates) {
      try {
        await step.runMutation(aiMetadataInternal.startAiMetadataWorkflow, {
          cardId,
          startAsync: true,
        });
      } catch (error) {
        failedCardIds.push(cardId);
        console.error(`${LOG_PREFIX} Failed to start pipeline`, {
          cardId,
          error,
        });
      }
    }

    const enqueuedCount = candidates.length - failedCardIds.length;

    if (enqueuedCount > 0) {
      console.info(`${LOG_PREFIX} Enqueued ${enqueuedCount} cards`);
    }

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
