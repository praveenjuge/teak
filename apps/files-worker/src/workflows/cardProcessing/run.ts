import { NonRetryableError } from "cloudflare:workflows";
import { internal } from "@teak/convex/_generated/api";
import type { Id } from "@teak/convex/_generated/dataModel";
import { stageFailed } from "@teak/convex/card/processingStatus";
import { ARTICLE_SUMMARY_MIN_WORDS } from "@teak/convex/shared/article";
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
import { ARCHIVE_STEP, archivePage, markArchiveFailed } from "./archive";
import {
  EXTRACT_ARTICLE_STEP,
  extractArticle,
  markArticleFailed,
  SUMMARIZE_ARTICLE_STEP,
  summarizeArticle,
} from "./article";
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
import { readLinkImageText } from "./linkText";
import { generateCardMetadata, type MetadataResult } from "./metadata";
import {
  findPodcastEpisode,
  isPodcastLink,
  transcribeFoundEpisode,
} from "./podcast";
import {
  extractPaletteFromImage,
  generateRenderables,
  type RenderablesResult,
} from "./renderables";
import { captureScreenshotStep, SCREENSHOT_STEP } from "./screenshot";

// Step names are durable history: never rename one, and add new steps after
// the existing ones.

export interface CardProcessingParams {
  /**
   * Only "load card", "archive page" and the article steps: a link's saved
   * copy and the article in it.
   */
  archiveOnly?: boolean;
  /** Only "load card", "extract article" and "summarize article". */
  articleOnly?: boolean;
  cardId: string;
  metadataOnly?: boolean;
  refresh?: boolean;
  rev: number;
}

const LINK_METADATA_STEP = retryConfig(5, 5000);
const CATEGORIZE_STEP = retryConfig(5, 1200);
const RENDERABLES_STEP = retryConfig(4, 5000);
const RENDERABLES_ATTEMPTS = 4;
const PODCAST_STEP = retryConfig(2, 60_000, "15 minutes");
const LINK_TEXT_STEP = retryConfig(3, 30_000, "5 minutes");

const METADATA_ATTEMPTS = 8;
const METADATA_INITIAL_BACKOFF_MS = 400;
export const AI_CAPACITY_RETRIES = 10;

export const METADATA_STEP: StepConfig = {
  retries: {
    // The function computes the whole wait; Workflows' default exponential
    // backoff would otherwise scale it again.
    backoff: "constant",
    delay: ({ ctx, error }) =>
      isAiProviderCapacityError(error)
        ? (`${ctx.attempt * 30} seconds` as const)
        : METADATA_INITIAL_BACKOFF_MS * 2 ** (ctx.attempt - 1),
    limit: AI_CAPACITY_RETRIES,
  },
  timeout: "15 minutes",
};

// A NonRetryableError thrown inside a step reaches the workflow as a plain
// Error whose message starts with "NonRetryableError: " (engine.test.ts).
const NON_RETRYABLE_PREFIX = /^NonRetryableError:\s*/u;

export const isSuperseded = (error: unknown): boolean => {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).replace(NON_RETRYABLE_PREFIX, "");
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
  /** The link has an article, which a metadata-only run summarizes again. */
  hasArticle?: true;
  /** The link's stored category, for a metadata-only run's podcast check. */
  linkCategory?: string;
  rev: number;
}

export type CardProcessingResult =
  | {
      categorization?: { category: string; confidence: number };
      classification: { confidence: number; type: string };
      metadata: Pick<
        MetadataResult,
        | "aiLanguage"
        | "aiPromptVersion"
        | "aiTagsCount"
        | "hasSummary"
        | "hasTranscript"
        | "mode"
      >;
      mode: "completed";
      renderables?: { thumbnailGenerated: boolean };
    }
  | { mode: "archive_only"; archive: string; article: string }
  | { mode: "article_only"; article: string }
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
  const archiveOnly = params.archiveOnly === true;
  const articleOnly = !archiveOnly && params.articleOnly === true;
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
        return await processCard(job, step, reported, {
          archiveOnly,
          articleOnly,
          metadataOnly,
        });
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
  {
    archiveOnly,
    articleOnly,
    metadataOnly,
  }: { archiveOnly: boolean; articleOnly: boolean; metadataOnly: boolean }
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
        ...(card.article?.status === "ready" ? { hasArticle: true } : {}),
        ...(card.metadata?.linkCategory?.category
          ? { linkCategory: card.metadata.linkCategory.category }
          : {}),
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

  if (archiveOnly) {
    const archive = await archivePageStep(job, step);
    return {
      archive,
      article: await articleSteps(job, step),
      mode: "archive_only",
    };
  }
  if (articleOnly) {
    return { article: await articleSteps(job, step), mode: "article_only" };
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
    const metadata = classified.shouldGenerateMetadata
      ? await runMetadataStep(job, step, reported, cardType)
      : null;
    // An episode whose first run had no AI metadata wasn't transcribed.
    if (
      isPodcastLink(cardType, initial.linkCategory) &&
      metadata?.mode === "completed"
    ) {
      await transcribePodcastStep(job, step, { keepTranscript: true });
    }
    // The metadata just written summarized the page without its article.
    if (initial.hasArticle && metadata?.mode === "completed") {
      await summarizeArticleStep(job, step);
    }
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
        rethrowSuperseded(error);
        console.error("[cardProcessing] Screenshot failed", {
          cardId: job.cardId,
          error: error instanceof Error ? error.message : String(error),
        });
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
    await step
      .do("read link image text", LINK_TEXT_STEP, () => readLinkImageText(job))
      .catch((error: unknown) => {
        rethrowSuperseded(error);
        console.warn("[cardProcessing] Link image text failed", {
          cardId: job.cardId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
  }

  await step
    .do("emit completion", NO_RETRY("1 minute"), async () => {
      await emitCardProcessingCompleted(job.env, {
        ...(metadata?.aiLanguage ? { aiLanguage: metadata.aiLanguage } : {}),
        cardType,
        durationMs: Math.max(0, Date.now() - initial.creationTime),
      });
      return null;
    })
    .catch(() => null);

  // A podcast episode's transcript comes after the card is complete: no
  // stage waits on it, and a miss or an error never fails the card.
  if (
    isPodcastLink(cardType, categorization?.category) &&
    metadata?.mode === "completed"
  ) {
    await transcribePodcastStep(job, step);
  }

  // The last step, whether or not AI metadata finished: the page's saved
  // copy. A failure fails only its own stage.
  // Then the article in it, and a summary written from that.
  if (cardType === "link") {
    await archivePageStep(job, step);
    await articleSteps(job, step);
  }

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
    ...(metadata?.aiLanguage ? { aiLanguage: metadata.aiLanguage } : {}),
    ...(metadata?.aiPromptVersion
      ? { aiPromptVersion: metadata.aiPromptVersion }
      : {}),
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

/**
 * "archive page", and "mark archive failed" once its retries are spent; only
 * a superseded run's error escapes. Says what happened, for the run's result.
 */
const archivePageStep = async (
  job: CardJob,
  step: WorkflowRun<CardProcessingParams>["step"]
): Promise<string> => {
  try {
    const outcome = await step.do("archive page", ARCHIVE_STEP, () =>
      archivePage(job)
    );
    return outcome.status === "archived"
      ? outcome.kind
      : `${outcome.status}:${outcome.reason}`;
  } catch (error) {
    rethrowSuperseded(error);
    console.warn("[cardProcessing] Page archive failed", {
      cardId: job.cardId,
      error: error instanceof Error ? error.message : String(error),
    });
    await step
      .do("mark archive failed", CONVEX_STEP, () => markArchiveFailed(job))
      .catch((markError: unknown) => {
        rethrowSuperseded(markError);
        return null;
      });
    return "failed:unreachable";
  }
};

/**
 * "extract article", then "summarize article" when it made one. A failure
 * fails only the article stage ("mark article failed"); a summary that can't
 * be written leaves the one the card has. Only a superseded run's error
 * escapes. Says what happened, for the run's result.
 */
const articleSteps = async (
  job: CardJob,
  step: WorkflowRun<CardProcessingParams>["step"]
): Promise<string> => {
  let extracted: Awaited<ReturnType<typeof extractArticle>>;
  try {
    extracted = await step.do("extract article", EXTRACT_ARTICLE_STEP, () =>
      extractArticle(job)
    );
  } catch (error) {
    rethrowSuperseded(error);
    console.warn("[cardProcessing] Article extraction failed", {
      cardId: job.cardId,
      error: error instanceof Error ? error.message : String(error),
    });
    await step
      .do("mark article failed", CONVEX_STEP, () => markArticleFailed(job))
      .catch((markError: unknown) => {
        rethrowSuperseded(markError);
        return null;
      });
    return "failed:extract_error";
  }
  if (extracted.status !== "extracted") {
    return "reason" in extracted
      ? `${extracted.status}:${extracted.reason}`
      : extracted.status;
  }
  // A short article adds little to the summary the page's details made.
  if (extracted.wordCount >= ARTICLE_SUMMARY_MIN_WORDS) {
    await summarizeArticleStep(job, step);
  }
  return "article";
};

/** "summarize article", logged; only a superseded run's error escapes. */
const summarizeArticleStep = async (
  job: CardJob,
  step: WorkflowRun<CardProcessingParams>["step"]
) => {
  try {
    const outcome = await step.do(
      "summarize article",
      SUMMARIZE_ARTICLE_STEP,
      () =>
        withWorkflowTelemetry(job.env, (telemetry) =>
          summarizeArticle(job, telemetry)
        )
    );
    return outcome;
  } catch (error) {
    rethrowSuperseded(error);
    console.warn("[cardProcessing] Article summary failed", {
      cardId: job.cardId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

/**
 * The podcast transcript, logged; only a superseded run's error escapes. The
 * episode is found, and the owner's hourly slot taken, in a step of its own:
 * its result is kept, so retrying the transcription never takes another slot.
 */
const transcribePodcastStep = async (
  job: CardJob,
  step: WorkflowRun<CardProcessingParams>["step"],
  options: { keepTranscript?: boolean } = {}
) => {
  try {
    const found = await step.do("find podcast episode", PODCAST_STEP, () =>
      findPodcastEpisode(job, options)
    );
    const outcome =
      "audioUrl" in found
        ? await step.do("transcribe podcast", PODCAST_STEP, () =>
            withWorkflowTelemetry(job.env, (telemetry) =>
              transcribeFoundEpisode(job, telemetry, found, options)
            )
          )
        : found;
    console.log("[cardProcessing] podcast transcript", {
      cardId: job.cardId,
      ...outcome,
    });
    return outcome;
  } catch (error) {
    rethrowSuperseded(error);
    console.warn("[cardProcessing] Podcast transcript failed", {
      cardId: job.cardId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

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
              capacity: ctx.attempt > AI_CAPACITY_RETRIES ? "defer" : "retry",
              lastAttempt: ctx.attempt >= METADATA_ATTEMPTS,
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
