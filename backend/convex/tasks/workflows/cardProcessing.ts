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
import { workflow } from "./manager";
import { internal, api } from "../../_generated/api";

// Helper to get properly typed internal references
const internalWorkflow = internal as any;

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
    // Step 1: Classification
    // Determine the card type using AI
    const classification = await step.runAction(
      internalWorkflow["tasks/workflows/steps/classification"].classify,
      { cardId }
    );

    // Step 2: Categorization (conditional - only for links)
    // Wait for link metadata extraction if needed, then categorize and enrich
    let categorization: { category: string; confidence: number } | undefined;
    if (classification.shouldCategorize) {
      // The categorization step will throw if metadata isn't ready yet
      // and workflow will retry automatically with the configured backoff
      const categorizationResult = await step.runAction(
        internalWorkflow["tasks/workflows/steps/categorization/index"].categorize,
        { cardId }
      );

      categorization = {
        category: categorizationResult.category,
        confidence: categorizationResult.confidence,
      };
    }

    // Step 3: Metadata Generation
    // Generate AI tags and summary for all card types
    const metadata = await step.runAction(
      internalWorkflow["tasks/workflows/steps/metadata"].generate,
      { cardId, cardType: classification.type }
    );

    // Step 4: Renderables (conditional - only for image/video/document)
    // Generate thumbnails and other visual assets
    let renderables: { thumbnailGenerated: boolean } | undefined;
    if (classification.shouldGenerateRenderables) {
      const renderablesResult = await step.runAction(
        internalWorkflow["tasks/workflows/steps/renderables"].generate,
        { cardId, cardType: classification.type }
      );

      renderables = {
        thumbnailGenerated: renderablesResult.thumbnailGenerated,
      };
    }

    return {
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
  },
});
