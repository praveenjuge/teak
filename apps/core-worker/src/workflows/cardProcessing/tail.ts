import { internal } from "@teak/convex/_generated/api";
import { stageFailed } from "@teak/convex/shared/processingStatus";
import { errorMessage } from "../../errors";
import { rethrowSuperseded } from "../errors";
import {
  CONVEX_STEP,
  exponentialStep,
  type StepContext,
  type Steps,
  stepAttempts,
} from "../runtime";
import { reportedStep, withWorkflowTelemetry } from "../telemetry";
import { type CardJob, guardOf, loadCard } from "./context";
import { readLinkImageText } from "./linkText";
import { findPodcastEpisode, transcribeFoundEpisode } from "./podcast";
import { captureScreenshotStep, SCREENSHOT_STEP } from "./screenshot";

// The stages that follow a card's AI metadata, shared by card processing and
// the AI backfill queue, which runs them again once metadata it had to wait
// for has come. Step names are durable history: never rename one.

const PODCAST_STEP = exponentialStep(2, 60_000, "15 minutes");
const LINK_TEXT_STEP = exponentialStep(3, 30_000, "5 minutes");

export interface TailSteps {
  do: Steps["do"];
  /** Each step gets one try, so that try is its last. */
  readonly once?: true;
}

/** Runs each step's body once, outside Workflows: the backfill queue's runner. */
export const onceSteps: TailSteps = {
  do: <T>(
    _name: string,
    configOrBody: unknown,
    body?: (ctx: StepContext) => Promise<T>
  ): Promise<T> =>
    (body ?? (configOrBody as (ctx: StepContext) => Promise<T>))({
      attempt: 1,
    }),
  once: true,
};

/**
 * "capture screenshot" from the saved copy (so it keeps the page's styles),
 * then "read link image text" from the preview image or that screenshot.
 * Only a superseded run's error escapes.
 */
export const linkScreenshotSteps = async (
  job: CardJob,
  step: TailSteps
): Promise<void> => {
  await step
    .do(
      "capture screenshot",
      SCREENSHOT_STEP,
      reportedStep(
        job.env,
        {
          cardId: job.cardId,
          maxAttempts: stepAttempts(SCREENSHOT_STEP),
          name: "card.screenshot",
          stage: "screenshot",
        },
        (ctx) =>
          captureScreenshotStep(
            job,
            ctx.attempt,
            step.once ? { lastAttempt: true } : {}
          )
      )
    )
    .catch(async (error: unknown) => {
      rethrowSuperseded(error);
      console.error("[cardProcessing] Screenshot failed", {
        cardId: job.cardId,
        error: errorMessage(error),
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
        error: errorMessage(error),
      });
      return null;
    });
};

/**
 * "find podcast episode", then "transcribe podcast" when it found one. A miss
 * or an error never fails the card; only a superseded run's error escapes.
 */
export const podcastTranscriptSteps = async (
  job: CardJob,
  step: TailSteps,
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
      error: errorMessage(error),
    });
    return null;
  }
};
