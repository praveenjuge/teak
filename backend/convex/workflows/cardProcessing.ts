/**
 * Card Processing Workflow
 *
 * Main workflow that orchestrates the complete card processing pipeline:
 * 1. Classification - Determine card type
 * 2. Categorization - For links, classify and enrich with provider data
 * 3. Metadata Generation - Generate AI tags and summary
 * 4. Renderables - Generate thumbnails and visual assets
 */

import { v } from "convex/values";
import type { RetryBehavior } from "@convex-dev/workpool";
import { workflow } from "./manager";
import { internal } from "../_generated/api";

// Helper to get properly typed internal references
const internalWorkflow = internal as any;

const METADATA_STEP_RETRY: RetryBehavior = {
  maxAttempts: 10,
  initialBackoffMs: 1000,
  base: 2,
};
const LINK_ENRICHMENT_STEP_RETRY: RetryBehavior = {
  maxAttempts: 5,
  initialBackoffMs: 5000,
  base: 2,
};

const PIPELINE_LOG_PREFIX = "[workflow/cardProcessing]";

/**
 * Main Card Processing Workflow
 *
 * Orchestrates all AI processing steps for a card in sequence.
 * Each step can be retried independently via workflow retry configuration.
 */
export const cardProcessingWorkflow: any = workflow.define({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.object({
    success: v.boolean(),
    classification: v.object({
      type: v.string(),
      confidence: v.number(),
    }),
    categorization: v.optional(
      v.object({
        category: v.string(),
        confidence: v.number(),
      })
    ),
    metadata: v.object({
      aiTagsCount: v.number(),
      hasSummary: v.boolean(),
      hasTranscript: v.boolean(),
    }),
    renderables: v.optional(
      v.object({
        thumbnailGenerated: v.boolean(),
      })
    ),
  }),
  handler: async (step, { cardId }) => {
    console.info(`${PIPELINE_LOG_PREFIX} Starting workflow`, { cardId });

    // Step 1: Classification
    // Determine the card type using AI
    console.info(`${PIPELINE_LOG_PREFIX} Running classification`, { cardId });
    const classification = await step.runAction(
      internalWorkflow["workflows/steps/classification"].classify,
      { cardId }
    );
    console.info(`${PIPELINE_LOG_PREFIX} Classification complete`, {
      cardId,
      type: classification.type,
      confidence: classification.confidence,
      shouldCategorize: classification.shouldCategorize,
      shouldGenerateRenderables: classification.shouldGenerateRenderables,
    });

    // Step 2: Categorization (conditional - only for links)
    // Wait for link metadata extraction if needed, then categorize and enrich
    let categorization: { category: string; confidence: number } | undefined;
    if (classification.shouldCategorize) {
      console.info(`${PIPELINE_LOG_PREFIX} Running categorization`, { cardId });
      const classifyStepResult = await step.runAction(
        internalWorkflow["workflows/steps/categorization/index"].classifyStep,
        { cardId },
        { retry: LINK_ENRICHMENT_STEP_RETRY }
      );

      let structuredData: unknown = null;
      if (classifyStepResult.mode === "classified") {
        const structuredResult = await step.runAction(
          internalWorkflow["workflows/steps/categorization/index"].fetchStructuredDataStep,
          {
            cardId,
            sourceUrl: classifyStepResult.sourceUrl,
            shouldFetch: classifyStepResult.shouldFetchStructured,
          },
          { retry: LINK_ENRICHMENT_STEP_RETRY }
        );
        structuredData = structuredResult.structuredData ?? null;
      }

      const categorizationResult = await step.runAction(
        internalWorkflow["workflows/steps/categorization/index"].mergeAndSaveStep,
        {
          cardId,
          card: classifyStepResult.card,
          sourceUrl: classifyStepResult.sourceUrl,
          mode: classifyStepResult.mode,
          classification: classifyStepResult.classification,
          existingMetadata: classifyStepResult.existingMetadata,
          structuredData,
          notifyPipeline: false,
          triggeredAsync: false,
        },
        { retry: LINK_ENRICHMENT_STEP_RETRY }
      );

      categorization = {
        category: categorizationResult.category,
        confidence: categorizationResult.confidence,
      };
      console.info(`${PIPELINE_LOG_PREFIX} Categorization complete`, {
        cardId,
        category: categorization.category,
        confidence: categorization.confidence,
      });
    }

    // Step 3: Metadata Generation
    // Generate AI tags and summary for all card types
    console.info(`${PIPELINE_LOG_PREFIX} Running metadata generation`, {
      cardId,
      cardType: classification.type,
    });
    const metadata = await step.runAction(
      internalWorkflow["workflows/steps/metadata"].generate,
      { cardId, cardType: classification.type },
      { retry: METADATA_STEP_RETRY }
    );
    console.info(`${PIPELINE_LOG_PREFIX} Metadata generation complete`, {
      cardId,
      tags: metadata.aiTags.length,
      hasSummary: !!metadata.aiSummary,
      hasTranscript: !!metadata.aiTranscript,
    });

    // Step 4: Renderables (conditional - only for image/video/document)
    // Generate thumbnails and other visual assets
    let renderables: { thumbnailGenerated: boolean } | undefined;
    if (classification.shouldGenerateRenderables) {
      console.info(`${PIPELINE_LOG_PREFIX} Running renderables generation`, {
        cardId,
        cardType: classification.type,
      });
      const renderablesResult = await step.runAction(
        internalWorkflow["workflows/steps/renderables"].generate,
        { cardId, cardType: classification.type }
      );

      renderables = {
        thumbnailGenerated: renderablesResult.thumbnailGenerated,
      };
      console.info(`${PIPELINE_LOG_PREFIX} Renderables generation complete`, {
        cardId,
        thumbnailGenerated: renderables.thumbnailGenerated,
      });
    }

    const result = {
      success: true,
      classification: {
        type: classification.type,
        confidence: classification.confidence,
      },
      categorization,
      metadata: {
        aiTagsCount: metadata.aiTags.length,
        hasSummary: !!metadata.aiSummary,
        hasTranscript: !!metadata.aiTranscript,
      },
      renderables,
    };

    console.info(`${PIPELINE_LOG_PREFIX} Workflow completed`, {
      cardId,
      classification: result.classification,
      hasCategorization: !!categorization,
      hasRenderables: !!renderables,
    });

    return result;
  },
});
