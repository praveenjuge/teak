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
  maxAttempts: 8,
  initialBackoffMs: 400,
  base: 1.8,
};
const LINK_METADATA_STEP_RETRY: RetryBehavior = {
  maxAttempts: 5,
  initialBackoffMs: 5000,
  base: 2,
};
const LINK_ENRICHMENT_STEP_RETRY: RetryBehavior = {
  maxAttempts: 5,
  initialBackoffMs: 1200,
  base: 1.6,
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
    console.info(`${PIPELINE_LOG_PREFIX} Starting`, { cardId });

    const initialCard = await step.runQuery(
      internalWorkflow["linkMetadata"].getCardForMetadata,
      { cardId }
    );

    // Step 1: Classification
    // If already classified (client-provided type), reuse it; otherwise run classifier
    const existingClassifyStatus = initialCard?.processingStatus?.classify;
    const classification = existingClassifyStatus?.status === "completed" && initialCard
      ? {
        type: initialCard.type,
        confidence: existingClassifyStatus.confidence ?? 1,
        needsLinkMetadata:
          initialCard.type === "link" &&
          initialCard.metadata?.linkPreview?.status !== "success",
        shouldCategorize: initialCard.type === "link",
        shouldGenerateMetadata: true,
        shouldGenerateRenderables: ["image", "video", "document"].includes(initialCard.type ?? ""),
      }
      : await step.runAction(
        internalWorkflow["workflows/steps/classification"].classify,
        { cardId }
      );

    // Palette extraction for image cards
    const palettePromise = classification.type === "image"
      ? step
        .runAction(
          internalWorkflow["workflows/steps/palette"].extractPaletteFromImage,
          { cardId }
        )
        .catch((error: unknown) => {
          console.error(`${PIPELINE_LOG_PREFIX} Palette extraction failed`, {
            cardId,
            error,
          });
          return null;
        })
      : Promise.resolve(null);

    // Ensure link metadata is ready before proceeding with downstream AI steps.
    if (classification.type === "link") {
      const linkMetadataCard = await step.runQuery(
        internalWorkflow["linkMetadata"].getCardForMetadata,
        { cardId }
      );
      const needsLinkMetadata =
        !!linkMetadataCard?.url &&
        linkMetadataCard?.metadataStatus === "pending";

      if (needsLinkMetadata) {
        await step.runAction(
          internalWorkflow["workflows/steps/linkMetadata/fetchMetadata"]
            .fetchMetadata,
          { cardId },
          { retry: LINK_METADATA_STEP_RETRY }
        );
      }
    }

    // Step 2: Categorization (conditional - only for links)
    // Wait for link metadata extraction if needed, then categorize and enrich
    let categorization: { category: string; confidence: number } | undefined;
    if (classification.shouldCategorize) {
      const classifyStepResult = await step.runAction(
        internalWorkflow["workflows/steps/categorization/index"].classifyStep,
        { cardId },
        { retry: LINK_ENRICHMENT_STEP_RETRY }
      );

      let structuredData: unknown = null;
      if (
        classifyStepResult.mode === "classified" &&
        classifyStepResult.shouldFetchStructured
      ) {
        const structuredResult = await step.runAction(
          internalWorkflow["workflows/steps/categorization/index"].fetchStructuredDataStep,
          {
            cardId,
            sourceUrl: classifyStepResult.sourceUrl,
            shouldFetch: true,
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
        },
        { retry: LINK_ENRICHMENT_STEP_RETRY }
      );

      categorization = {
        category: categorizationResult.category,
        confidence: categorizationResult.confidence,
      };
    }

    // Step 3 & 4: Metadata generation and renderables can run in parallel when needed
    const metadataPromise = classification.shouldGenerateMetadata
      ? step.runAction(
        internalWorkflow["workflows/steps/metadata"].generate,
        { cardId, cardType: classification.type },
        { retry: METADATA_STEP_RETRY }
      )
      : Promise.resolve(null);

    const renderablesPromise = classification.shouldGenerateRenderables
      ? step.runAction(
        internalWorkflow["workflows/steps/renderables"].generate,
        { cardId, cardType: classification.type }
      )
      : Promise.resolve(null);

    const [metadataResult, renderablesResult] = await Promise.all([
      metadataPromise,
      renderablesPromise,
    ]);

    await palettePromise;

    const metadata = metadataResult ?? {
      aiTags: [],
      aiSummary: undefined,
      aiTranscript: undefined,
    };

    const renderables = renderablesResult
      ? { thumbnailGenerated: renderablesResult.thumbnailGenerated }
      : undefined;

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

    console.info(`${PIPELINE_LOG_PREFIX} Completed`, {
      cardId,
      type: classification.type,
      tags: metadata.aiTags.length,
    });

    return result;
  },
});
