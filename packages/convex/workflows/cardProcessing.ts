import type { RetryBehavior } from "@convex-dev/workpool";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { buildErrorPreview } from "../linkMetadata";
import { parseLinkMetadataRetryableError } from "./linkMetadata";
import { workflow } from "./manager";

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
export const RENDERABLES_STEP_RETRY: RetryBehavior = {
  maxAttempts: 4,
  initialBackoffMs: 5000,
  base: 2,
};

const PIPELINE_LOG_PREFIX = "[workflow/cardProcessing]";

export const resolveCardProcessingDurationMs = (
  creationTime: number | undefined,
  now = Date.now()
): number | undefined =>
  creationTime === undefined ? undefined : Math.max(0, now - creationTime);

// Old journals contain strings; new steps return only persisted-result facts.
export const normalizeWorkflowMetadataResult = (
  result: {
    aiTagsCount?: number;
    hasSummary?: boolean;
    hasTranscript?: boolean;
    aiTags?: string[];
    aiSummary?: string;
    aiTranscript?: string;
  } | null
) => ({
  aiTagsCount: result?.aiTagsCount ?? result?.aiTags?.length ?? 0,
  hasSummary: result?.hasSummary ?? Boolean(result?.aiSummary),
  hasTranscript: result?.hasTranscript ?? Boolean(result?.aiTranscript),
});

export const createMissingCardWorkflowResult = () => ({
  success: true as const,
  mode: "skipped" as const,
  reason: "card_missing" as const,
});

export const cardProcessingWorkflow: any = workflow.define({
  args: {
    cardId: v.id("cards"),
    refresh: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({
      success: v.boolean(),
      mode: v.literal("completed"),
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
    v.object({
      success: v.boolean(),
      mode: v.literal("skipped"),
      reason: v.literal("card_missing"),
    })
  ),
  handler: async (step, { cardId, refresh }) => {
    console.info(`${PIPELINE_LOG_PREFIX} Starting`, { cardId });

    const initialCard = await step.runQuery(
      internalWorkflow.linkMetadata.getCardForMetadata,
      { cardId }
    );

    if (!initialCard) {
      return createMissingCardWorkflowResult();
    }

    const artifactOwner =
      initialCard.workflowPayloadVersion === 1
        ? { workflowId: step.workflowId }
        : {};

    const existingClassifyStatus = initialCard?.processingStatus?.classify;
    const classification =
      existingClassifyStatus?.status === "completed" && initialCard
        ? {
            mode: "completed" as const,
            type: initialCard.type,
            confidence: existingClassifyStatus.confidence ?? 1,
            needsLinkMetadata:
              initialCard.type === "link" &&
              initialCard.metadata?.linkPreview?.status !== "success",
            shouldCategorize: initialCard.type === "link",
            shouldGenerateMetadata: true,
            shouldGenerateRenderables: ["image", "video", "document"].includes(
              initialCard.type ?? ""
            ),
          }
        : await step.runAction(
            internalWorkflow["workflows/steps/classification"].classify,
            { cardId }
          );

    if (classification.mode === "skipped") {
      return createMissingCardWorkflowResult();
    }

    if (classification.type === "link") {
      const linkMetadataCard = await step.runQuery(
        internalWorkflow.linkMetadata.getCardForMetadata,
        { cardId }
      );
      const needsLinkMetadata =
        !!linkMetadataCard?.url &&
        linkMetadataCard?.metadataStatus === "pending";

      if (needsLinkMetadata) {
        try {
          await step.runAction(
            internalWorkflow["workflows/steps/linkMetadata/fetchMetadata"]
              .fetchMetadata,
            refresh ? { cardId, refresh } : { cardId },
            { retry: LINK_METADATA_STEP_RETRY }
          );
        } catch (error) {
          // A refresh that still can't read the page keeps the preview the
          // card has and goes on; an automatic run fails as before.
          const retryable = refresh
            ? parseLinkMetadataRetryableError(error)
            : null;
          if (!retryable) {
            throw error;
          }
          await step.runMutation(
            internalWorkflow.linkMetadata.updateCardMetadata,
            {
              cardId,
              linkPreview: buildErrorPreview(retryable.normalizedUrl ?? "", {
                type: retryable.type ?? "error",
                message: retryable.message,
                details: retryable.details,
              }),
              status: "failed",
              refresh,
            }
          );
        }
      }
    }

    let categorization: { category: string; confidence: number } | undefined;
    if (classification.shouldCategorize) {
      const categorizationOutcome = await (async () => {
        const classifyStepResult = await step.runAction(
          internalWorkflow["workflows/steps/categorization/index"].classifyStep,
          { cardId, ...artifactOwner, ...(refresh ? { refresh } : {}) },
          { retry: LINK_ENRICHMENT_STEP_RETRY }
        );

        if (classifyStepResult.mode === "missing") {
          return null;
        }

        let structuredData: unknown = null;
        if (
          classifyStepResult.mode === "classified" &&
          classifyStepResult.shouldFetchStructured
        ) {
          const structuredResult = await step.runAction(
            internalWorkflow["workflows/steps/categorization/index"]
              .fetchStructuredDataStep,
            {
              cardId,
              sourceUrl: classifyStepResult.sourceUrl,
              shouldFetch: true,
              ...artifactOwner,
            },
            { retry: LINK_ENRICHMENT_STEP_RETRY }
          );
          structuredData = structuredResult.structuredData ?? null;
        }

        const categorizationResult = await step.runAction(
          internalWorkflow["workflows/steps/categorization/index"]
            .mergeAndSaveStep,
          {
            cardId,
            card: classifyStepResult.card,
            sourceUrl: classifyStepResult.sourceUrl,
            mode: classifyStepResult.mode,
            classification: classifyStepResult.classification,
            existingMetadata: classifyStepResult.existingMetadata,
            structuredData,
            ...artifactOwner,
          },
          { retry: LINK_ENRICHMENT_STEP_RETRY }
        );

        return {
          category: categorizationResult.category,
          confidence: categorizationResult.confidence,
        };
      })();
      if (!categorizationOutcome) {
        return createMissingCardWorkflowResult();
      }
      categorization = categorizationOutcome;
    }

    let metadataResult: any = null;
    let renderablesResult: any = null;
    const runRenderablesStep = async () => {
      try {
        return await step.runAction(
          internalWorkflow["workflows/steps/renderables"].generate,
          { cardId, cardType: classification.type },
          { retry: RENDERABLES_STEP_RETRY }
        );
      } catch (error) {
        console.error(`${PIPELINE_LOG_PREFIX} Renderables exhausted retries`, {
          cardId,
          error,
        });
        await step.runMutation(
          internalWorkflow["workflows/steps/renderables/mutations"]
            .markCardRenderablesFailed,
          { cardId, error: "thumbnail_generation_failed" }
        );
        return {
          mode: "completed" as const,
          success: false,
          thumbnailGenerated: false,
        };
      }
    };

    if (["image", "video"].includes(classification.type)) {
      renderablesResult = classification.shouldGenerateRenderables
        ? await runRenderablesStep()
        : null;

      if (classification.type === "image") {
        await step
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
          });
      }

      metadataResult = classification.shouldGenerateMetadata
        ? await step.runAction(
            internalWorkflow["workflows/steps/metadata"].generate,
            { cardId, cardType: classification.type },
            { retry: METADATA_STEP_RETRY }
          )
        : null;
    } else {
      const metadataPromise = classification.shouldGenerateMetadata
        ? step.runAction(
            internalWorkflow["workflows/steps/metadata"].generate,
            { cardId, cardType: classification.type },
            { retry: METADATA_STEP_RETRY }
          )
        : Promise.resolve(null);

      const renderablesPromise = classification.shouldGenerateRenderables
        ? runRenderablesStep()
        : Promise.resolve(null);

      [metadataResult, renderablesResult] = await Promise.all([
        metadataPromise,
        renderablesPromise,
      ]);
    }

    const metadata = normalizeWorkflowMetadataResult(metadataResult);

    const renderables = renderablesResult
      ? { thumbnailGenerated: renderablesResult.thumbnailGenerated }
      : undefined;

    const result = {
      success: true,
      mode: "completed" as const,
      classification: {
        type: classification.type,
        confidence: classification.confidence,
      },
      categorization,
      metadata,
      renderables,
    };

    console.info(`${PIPELINE_LOG_PREFIX} Completed`, {
      cardId,
      type: classification.type,
      tags: metadata.aiTagsCount,
    });

    const durationMs = resolveCardProcessingDurationMs(
      initialCard?._creationTime
    );
    if (durationMs === undefined) {
      console.warn(`${PIPELINE_LOG_PREFIX} Skipped completion duration`, {
        cardId: String(cardId),
        reason: "initial_card_missing",
      });
    } else {
      await step.runAction(
        internalWorkflow.telemetry.events.emitWorkflowCompletion,
        {
          cardId: String(cardId),
          cardType: classification.type,
          durationMs,
        }
      );
    }

    return result;
  },
});
