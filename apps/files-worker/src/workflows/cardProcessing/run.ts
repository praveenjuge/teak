import { NonRetryableError } from "cloudflare:workflows";
import { internal } from "@teak/convex/_generated/api";
import type { Id } from "@teak/convex/_generated/dataModel";
import { stageFailed } from "@teak/convex/card/processingStatus";
import {
  CONVEX_STEP,
  NO_RETRY,
  retryConfig,
  runReported,
  type StepConfig,
  type WorkflowRun,
} from "../runtime";
import {
  emitCardProcessingCompleted,
  reportedStep,
  withWorkflowTelemetry,
} from "../telemetry";
import { isAiProviderCapacityError } from "./aiMetadata";
import { categorizeLink } from "./categorization";
import { type CompletedClassification, classifyCard } from "./classification";
import {
  type CardJob,
  type CardProcessingDeps,
  createCardProcessingDeps,
  guardOf,
  loadCard,
  markInProgress,
} from "./context";
import {
  fetchLinkMetadata,
  keepPreviewAfterFailedRefresh,
  parseLinkMetadataRetryableError,
} from "./linkMetadata";
import { generateCardMetadata, type MetadataResult } from "./metadata";
import {
  extractPaletteFromImage,
  generateRenderables,
  type RenderablesResult,
} from "./renderables";
import { captureScreenshotStep, SCREENSHOT_STEP } from "./screenshot";

// Card processing: classify, link metadata, categorize, then AI metadata
// and renderables, then a link's screenshot. Step names are durable history:
// never rename one, and add new steps after the existing ones.

export interface CardProcessingParams {
  cardId: string;
  /** Only regenerate the AI metadata (the admin's AI backfill retry). */
  metadataOnly?: boolean;
  /**
   * A person asked to refresh the card ("Refresh details"): the link preview
   * and category are read again even when the stored ones worked.
   */
  refresh?: boolean;
  rev: number;
}

const LINK_METADATA_STEP = retryConfig(5, 5000);
const CATEGORIZE_STEP = retryConfig(5, 1200);
const RENDERABLES_STEP = retryConfig(4, 5000);
const RENDERABLES_ATTEMPTS = 4;

/** Attempts for any metadata failure but Workers AI capacity. */
const METADATA_ATTEMPTS = 8;
const METADATA_INITIAL_BACKOFF_MS = 400;
/** Workers AI capacity retries in the step before the backfill takes over. */
export const AI_CAPACITY_RETRIES = 10;

/**
 * Workers AI capacity (`rate limit reached 429`) backs off 30 s more each
 * attempt; anything else backs off exponentially for its 8 attempts.
 */
export const METADATA_STEP: StepConfig = {
  retries: {
    delay: ({ ctx, error }) =>
      isAiProviderCapacityError(error)
        ? (`${ctx.attempt * 30} seconds` as const)
        : METADATA_INITIAL_BACKOFF_MS * 2 ** (ctx.attempt - 1),
    limit: AI_CAPACITY_RETRIES,
  },
  timeout: "15 minutes",
};

/** A newer revision (an edit) or a deletion took the card from this run. */
export const isSuperseded = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.startsWith("stale_processing_revision") ||
    message.startsWith("card_missing")
  );
};

const rethrowSuperseded = (error: unknown): void => {
  if (isSuperseded(error)) {
    throw error;
  }
};

interface InitialFacts {
  classification: CompletedClassification | null;
  creationTime: number;
  rev: number;
}

export type CardProcessingResult =
  | {
      categorization?: { category: string; confidence: number };
      classification: { confidence: number; type: string };
      metadata: Pick<
        MetadataResult,
        "aiTagsCount" | "hasSummary" | "hasTranscript" | "mode"
      >;
      mode: "completed";
      renderables?: { thumbnailGenerated: boolean };
    }
  | { mode: "skipped"; reason: "card_missing" | "superseded" };

export const runCardProcessing = (
  run: WorkflowRun<CardProcessingParams>,
  overrides: Partial<CardProcessingDeps> = {}
): Promise<CardProcessingResult> => {
  const { env, params, step } = run;
  const job: CardJob = {
    cardId: params.cardId as Id<"cards">,
    convexSiteUrl: params.convexSiteUrl,
    deps: createCardProcessingDeps(env, params.convexSiteUrl, overrides),
    env,
    ...(params.refresh === true ? { refresh: true } : {}),
    rev: params.rev,
  };
  const metadataOnly = params.metadataOnly === true;
  return runReported(
    run,
    async () => {
      const reported = <T>(
        name: string,
        stage: string,
        maxAttempts: number,
        body: (ctx: { attempt: number }) => Promise<T>
      ) =>
        reportedStep(
          env,
          { cardId: job.cardId, maxAttempts, name, stage },
          body
        );

      try {
        return await processCard(job, step, reported, metadataOnly);
      } catch (error) {
        if (isSuperseded(error)) {
          return {
            mode: "skipped",
            reason: String(error).includes("card_missing")
              ? "card_missing"
              : "superseded",
          };
        }
        throw error;
      }
    },
    job.deps.convex
  );
};

type Reported = <T>(
  name: string,
  stage: string,
  maxAttempts: number,
  body: (ctx: { attempt: number }) => Promise<T>
) => (ctx: { attempt: number }) => Promise<T>;

const processCard = async (
  job: CardJob,
  step: WorkflowRun<CardProcessingParams>["step"],
  reported: Reported,
  metadataOnly: boolean
): Promise<CardProcessingResult> => {
  const initial = await step.do(
    "load card",
    CONVEX_STEP,
    async (): Promise<InitialFacts | null> => {
      const loaded = await loadCard(job);
      if (!loaded) {
        return null;
      }
      const { card } = loaded;
      const classify = card.processingStatus?.classify;
      return {
        classification:
          classify?.status === "completed"
            ? {
                confidence: classify.confidence ?? 1,
                mode: "completed",
                needsLinkMetadata:
                  card.type === "link" &&
                  card.metadata?.linkPreview?.status !== "success",
                shouldCategorize: card.type === "link",
                shouldGenerateMetadata: true,
                shouldGenerateRenderables: [
                  "image",
                  "video",
                  "document",
                ].includes(card.type),
                type: card.type,
              }
            : null,
        creationTime: card._creationTime,
        rev: card.processingRev ?? 0,
      };
    }
  );
  if (!initial) {
    return { mode: "skipped", reason: "card_missing" };
  }
  if (initial.rev !== job.rev) {
    return { mode: "skipped", reason: "superseded" };
  }

  const classified =
    initial.classification ??
    (await step.do(
      "classify",
      CONVEX_STEP,
      reported("card.classification", "classification", 9, () =>
        classifyCard(job)
      )
    ));
  if (classified.mode === "skipped") {
    return { mode: "skipped", reason: "card_missing" };
  }
  const cardType = classified.type;

  if (metadataOnly) {
    // Every other stage keeps what the card's earlier runs left.
    const metadata = classified.shouldGenerateMetadata
      ? await runMetadataStep(job, step, reported, cardType)
      : null;
    return completedResult(classified, cardType, metadata, null);
  }

  if (cardType === "link") {
    try {
      await step.do(
        "fetch link metadata",
        LINK_METADATA_STEP,
        reported("card.link_metadata", "link_metadata", 5, async () => {
          const card = (await loadCard(job))?.card;
          if (!card?.url || card.metadataStatus !== "pending") {
            return { status: "skipped" as const };
          }
          return await fetchLinkMetadata(job);
        })
      );
    } catch (error) {
      // A refresh that still can't read the page keeps the preview the card
      // has and goes on; an automatic run fails as before.
      const failure = job.refresh
        ? parseLinkMetadataRetryableError(error)
        : null;
      if (!failure || isSuperseded(error)) {
        throw error;
      }
      await step.do("keep link preview after refresh", CONVEX_STEP, () =>
        keepPreviewAfterFailedRefresh(job, failure)
      );
    }
  }

  let categorization: { category: string; confidence: number } | undefined;
  if (classified.shouldCategorize) {
    const categorized = await step.do(
      "categorize",
      CATEGORIZE_STEP,
      reported("card.categorization", "categorization", 5, () =>
        categorizeLink(job)
      )
    );
    if (categorized.mode === "missing") {
      return { mode: "skipped", reason: "card_missing" };
    }
    categorization = {
      category: categorized.category,
      confidence: categorized.confidence,
    };
  }

  const runRenderables = async (): Promise<RenderablesResult> => {
    try {
      return await step.do(
        "generate renderables",
        RENDERABLES_STEP,
        reported("card.renderables", "renderables", RENDERABLES_ATTEMPTS, () =>
          generateRenderables(job, cardType)
        )
      );
    } catch (error) {
      rethrowSuperseded(error);
      console.error("[cardProcessing] Renderables exhausted retries", {
        cardId: job.cardId,
        error: error instanceof Error ? error.message : String(error),
      });
      await step.do("mark renderables failed", CONVEX_STEP, async () => {
        await job.deps.convex.mutation(
          internal.workflows.steps.renderables.mutations
            .markCardRenderablesFailed,
          { cardId: job.cardId, error: "thumbnail_generation_failed" },
          guardOf(job)
        );
        return null;
      });
      return { mode: "completed", success: false, thumbnailGenerated: false };
    }
  };

  const runMetadata = () => runMetadataStep(job, step, reported, cardType);

  let metadata: MetadataResult | null = null;
  let renderables: RenderablesResult | null = null;
  if (cardType === "image" || cardType === "video") {
    renderables = classified.shouldGenerateRenderables
      ? await runRenderables()
      : null;
    if (cardType === "image") {
      await step
        .do("extract palette", NO_RETRY(), async () => {
          await extractPaletteFromImage(job);
          return null;
        })
        .catch((error: unknown) => {
          rethrowSuperseded(error);
          console.error("[cardProcessing] Palette extraction failed", {
            cardId: job.cardId,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        });
    }
    metadata = classified.shouldGenerateMetadata ? await runMetadata() : null;
  } else {
    [metadata, renderables] = await Promise.all([
      classified.shouldGenerateMetadata ? runMetadata() : null,
      classified.shouldGenerateRenderables ? runRenderables() : null,
    ]);
  }

  // A link's screenshot follows the AI metadata it was stored with.
  if (cardType === "link" && metadata?.mode === "completed") {
    await step
      .do(
        "capture screenshot",
        SCREENSHOT_STEP,
        reported("card.screenshot", "screenshot", 4, (ctx) =>
          captureScreenshotStep(job, ctx.attempt)
        )
      )
      .catch(async (error: unknown) => {
        // The screenshot is its own stage: a failure is recorded on it and
        // does not fail the card's run.
        rethrowSuperseded(error);
        console.error("[cardProcessing] Screenshot failed", {
          cardId: job.cardId,
          error: error instanceof Error ? error.message : String(error),
        });
        // A failure the step gave up on without recording (a final error)
        // must not leave the stage in progress.
        await step.do("mark screenshot failed", CONVEX_STEP, async () => {
          const loaded = await loadCard(job);
          const status = loaded?.card.processingStatus?.screenshot?.status;
          if (!loaded || status === "completed" || status === "failed") {
            return null;
          }
          await job.deps.convex.mutation(
            internal.ai.mutations.updateCardProcessing,
            {
              cardId: job.cardId,
              processingStatus: {
                screenshot: stageFailed(Date.now(), "screenshot_error"),
              },
            },
            guardOf(job)
          );
          return null;
        });
        return null;
      });
  }

  await step
    .do("emit completion", NO_RETRY("1 minute"), async () => {
      await emitCardProcessingCompleted(job.env, {
        cardType,
        durationMs: Math.max(0, Date.now() - initial.creationTime),
      });
      return null;
    })
    .catch(() => null);

  return {
    ...completedResult(classified, cardType, metadata, renderables),
    ...(categorization ? { categorization } : {}),
  };
};

const completedResult = (
  classified: { confidence: number },
  cardType: string,
  metadata: MetadataResult | null,
  renderables: RenderablesResult | null
): CardProcessingResult => ({
  classification: {
    confidence: classified.confidence,
    type: cardType,
  },
  metadata: {
    aiTagsCount: metadata?.aiTagsCount ?? 0,
    hasSummary: metadata?.hasSummary ?? false,
    hasTranscript: metadata?.hasTranscript ?? false,
    mode: metadata?.mode ?? "skipped",
  },
  mode: "completed",
  ...(renderables
    ? { renderables: { thumbnailGenerated: renderables.thumbnailGenerated } }
    : {}),
});

const runMetadataStep = (
  job: CardJob,
  step: WorkflowRun<CardProcessingParams>["step"],
  reported: Reported,
  cardType: string
): Promise<MetadataResult> =>
  step.do(
    "generate metadata",
    METADATA_STEP,
    reported(
      "card.ai_metadata",
      "ai_metadata",
      AI_CAPACITY_RETRIES + 1,
      async (ctx) => {
        try {
          await markInProgress(job, ["metadata"]);
          return await withWorkflowTelemetry(job.env, (telemetry) =>
            generateCardMetadata(job, telemetry, cardType, {
              // The last attempt leaves a card Workers AI still can't take
              // to the backfill.
              capacity: ctx.attempt > AI_CAPACITY_RETRIES ? "defer" : "retry",
              restorePendingOnDefer: true,
            })
          );
        } catch (error) {
          if (
            !isAiProviderCapacityError(error) &&
            ctx.attempt >= METADATA_ATTEMPTS &&
            !(error instanceof Error && error.name === "NonRetryableError")
          ) {
            throw new NonRetryableError(
              error instanceof Error ? error.message : String(error)
            );
          }
          throw error;
        }
      }
    )
  );
