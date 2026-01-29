import { v } from "convex/values";
import type { RetryBehavior } from "@convex-dev/workpool";
import { internalMutation } from "../_generated/server";
import { workflow } from "./manager";
import { internal } from "../_generated/api";

const internalWorkflow = internal as Record<string, any>;
const LOG_PREFIX = "[workflow/linkEnrichment]";

const LINK_ENRICHMENT_RETRY: RetryBehavior = {
  maxAttempts: 5,
  initialBackoffMs: 5000,
  base: 2,
};

export const linkEnrichmentWorkflow = workflow.define({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.object({
    category: v.string(),
    confidence: v.number(),
    imageUrl: v.optional(v.string()),
    factsCount: v.number(),
  }),
  handler: async (step, { cardId }) => {
    const classifyResult = await step.runAction(
      internalWorkflow["workflows/steps/categorization/index"].classifyStep,
      { cardId },
      { retry: LINK_ENRICHMENT_RETRY },
    );

    let structuredData: unknown = null;
    if (classifyResult.mode === "classified") {
      const fetchResult = await step.runAction(
        internalWorkflow["workflows/steps/categorization/index"].fetchStructuredDataStep,
        {
          cardId,
          sourceUrl: classifyResult.sourceUrl,
          shouldFetch: classifyResult.shouldFetchStructured,
        },
        { retry: LINK_ENRICHMENT_RETRY },
      );
      structuredData = fetchResult.structuredData ?? null;
    }

    const mergeResult = await step.runAction(
      internalWorkflow["workflows/steps/categorization/index"].mergeAndSaveStep,
      {
        cardId,
        card: classifyResult.card,
        sourceUrl: classifyResult.sourceUrl,
        mode: classifyResult.mode,
        classification: classifyResult.classification,
        existingMetadata: classifyResult.existingMetadata,
        structuredData,
      },
      { retry: LINK_ENRICHMENT_RETRY },
    );

    console.info(`${LOG_PREFIX} Completed`, { cardId, category: mergeResult.category });

    return mergeResult;
  },
});

export const startLinkEnrichmentWorkflow = internalMutation({
  args: {
    cardId: v.id("cards"),
    startAsync: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({
      workflowId: v.string(),
    }),
    v.object({
      category: v.string(),
      confidence: v.number(),
      imageUrl: v.optional(v.string()),
      factsCount: v.number(),
    })
  ),
  handler: async (ctx, { cardId, startAsync }) => {
    const result = await workflow.start(
      ctx,
      internalWorkflow["workflows/linkEnrichment"].linkEnrichmentWorkflow,
      { cardId },
      { startAsync: startAsync ?? false },
    );

    if (typeof result === "string") {
      return { workflowId: result };
    }

    return result;
  },
});
