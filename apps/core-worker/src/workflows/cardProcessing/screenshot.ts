import { internal } from "@teak/convex/_generated/api";
import {
  type ProcessingStageStatus,
  stageCompleted,
  stageFailed,
} from "@teak/convex/card/processingStatus";
import { normalizeUrl } from "@teak/convex/linkMetadata/url";
import type {
  FilesCaptureScreenshotParams,
  FilesCaptureScreenshotResult,
} from "@teak/files-protocol";
import type { StepConfig } from "../runtime";
import {
  type CardJob,
  ensureObjectOwnership,
  guardOf,
  loadCard,
  markInProgress,
  objectKey,
} from "./context";
import { fetchLinkPageForCard } from "./linkMetadata";

export const SCREENSHOT_RETRYABLE_PREFIX = "workflow:screenshot:retryable:";

export interface ScreenshotRetryableError {
  message?: string;
  type: "http_error" | "renderer_unavailable";
}

export const SCREENSHOT_RETRY_POLICY: Record<
  ScreenshotRetryableError["type"],
  { delayMs: number; maxRetries: number }
> = {
  http_error: { delayMs: 5000, maxRetries: 1 },
  renderer_unavailable: { delayMs: 30_000, maxRetries: 3 },
};

const throwRetryable = (info: ScreenshotRetryableError): never => {
  throw new Error(`${SCREENSHOT_RETRYABLE_PREFIX}${JSON.stringify(info)}`);
};

export const parseScreenshotRetryableError = (
  error: unknown
): ScreenshotRetryableError | null => {
  if (
    !(
      error instanceof Error &&
      error.message.startsWith(SCREENSHOT_RETRYABLE_PREFIX)
    )
  ) {
    return null;
  }
  try {
    return JSON.parse(
      error.message.slice(SCREENSHOT_RETRYABLE_PREFIX.length)
    ) as ScreenshotRetryableError;
  } catch {
    return null;
  }
};

export const SCREENSHOT_STEP: StepConfig = {
  retries: {
    // The function computes the whole wait; Workflows' default exponential
    // backoff would otherwise scale it again.
    backoff: "constant",
    delay: ({ error }) =>
      SCREENSHOT_RETRY_POLICY[
        parseScreenshotRetryableError(error)?.type ?? "renderer_unavailable"
      ].delayMs,
    limit: Math.max(
      ...Object.values(SCREENSHOT_RETRY_POLICY).map(
        ({ maxRetries }) => maxRetries
      )
    ),
  },
  timeout: "5 minutes",
};

export type ScreenshotOutcome =
  | { status: "captured" | "skipped" }
  | { reason: string; status: "failed" };

const recordStage = (job: CardJob, screenshot: ProcessingStageStatus) =>
  job.deps.convex.mutation(
    internal.ai.mutations.updateCardProcessing,
    { cardId: job.cardId, processingStatus: { screenshot } },
    guardOf(job)
  );

const render = async (
  job: CardJob,
  params: FilesCaptureScreenshotParams
): Promise<
  Awaited<ReturnType<typeof job.deps.filesOp<FilesCaptureScreenshotResult>>>
> => {
  try {
    return await job.deps.filesOp<FilesCaptureScreenshotResult>({
      op: "capture-screenshot",
      params,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "NonRetryableError") {
      throw error;
    }
    console.warn("[screenshot] Renderer unavailable", {
      cardId: job.cardId,
      error: error instanceof Error ? error.message : String(error),
    });
    return throwRetryable({
      message: error instanceof Error ? error.message : String(error),
      type: "renderer_unavailable",
    });
  }
};

const save = async (
  job: CardJob,
  screenshotKey: string,
  { height, width }: FilesCaptureScreenshotResult
): Promise<ScreenshotOutcome> => {
  await job.deps.convex.mutation(
    internal.linkMetadata.updateCardScreenshot,
    {
      cardId: job.cardId,
      screenshotHeight: height,
      screenshotStorageKey: screenshotKey,
      screenshotUpdatedAt: Date.now(),
      screenshotWidth: width,
    },
    guardOf(job)
  );
  return { status: "captured" };
};

const screenshotTarget = async (
  job: CardJob,
  userId: string
): Promise<string | null> => {
  const loaded = await loadCard(job);
  if (!loaded) {
    return null;
  }
  const key = objectKey(loaded, { cardId: job.cardId, role: "screenshot" });
  await ensureObjectOwnership(job, userId, key);
  return key;
};

const capture = async (
  job: CardJob,
  attempt: number
): Promise<ScreenshotOutcome> => {
  const card = await job.deps.convex.query(
    internal.linkMetadata.getCardForScreenshot,
    { cardId: job.cardId }
  );
  if (card?.type !== "link" || !card.url) {
    return { status: "skipped" };
  }
  const linkPreview = card.metadata?.linkPreview;
  if (linkPreview?.status !== "success") {
    return { status: "skipped" };
  }
  if (linkPreview.screenshotStorageKey && attempt === 1 && !job.refresh) {
    return { status: "skipped" };
  }

  // The saved copy carries the page's own styles, fonts and images; the
  // fetched page would render without them, since the renderer is offline.
  let screenshotKey: string | null = null;
  if (card.archiveKey) {
    screenshotKey = await screenshotTarget(job, card.userId);
    if (!screenshotKey) {
      return { status: "skipped" };
    }
    const outcome = await render(job, {
      archiveKey: card.archiveKey,
      destinationKey: screenshotKey,
    });
    if (outcome.kind === "ok") {
      return await save(job, screenshotKey, outcome.data);
    }
    console.warn("[screenshot] Saved copy declined; capturing the page", {
      cardId: job.cardId,
      code: outcome.code,
    });
  }

  let page: Awaited<ReturnType<typeof fetchLinkPageForCard>>;
  try {
    page = await fetchLinkPageForCard(job, normalizeUrl(card.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return throwRetryable({
      message,
      type: message.includes(":RENDERER_UNAVAILABLE:")
        ? "renderer_unavailable"
        : "http_error",
    });
  }
  if (page.kind !== "ok") {
    return { reason: page.code.toLowerCase(), status: "failed" };
  }
  if (!page.data.fetched) {
    const { reason, status } = page.data;
    if (
      reason === "http_error" &&
      status &&
      (status >= 500 || status === 429)
    ) {
      throwRetryable({ message: `HTTP ${status}`, type: "http_error" });
    }
    if (reason === "fetch_failed") {
      throwRetryable({ message: reason, type: "http_error" });
    }
    if (reason === "http_error") {
      return { reason: `http_${status ?? "error"}`, status: "failed" };
    }
    return {
      reason: reason === "unsupported_type" ? "not_html" : reason,
      status: "failed",
    };
  }

  screenshotKey ??= await screenshotTarget(job, card.userId);
  if (!screenshotKey) {
    return { status: "skipped" };
  }
  const outcome = await render(job, {
    destinationKey: screenshotKey,
    htmlGzipBase64: page.data.htmlGzipBase64,
  });
  if (outcome.kind === "fallback") {
    return {
      reason: `declined:${outcome.code.toLowerCase()}:${outcome.message}`.slice(
        0,
        200
      ),
      status: "failed",
    };
  }
  return await save(job, screenshotKey, outcome.data);
};

export const captureScreenshotStep = async (
  job: CardJob,
  attempt: number,
  options: { lastAttempt?: boolean } = {}
): Promise<ScreenshotOutcome> => {
  await markInProgress(job, ["screenshot"]);
  let outcome: ScreenshotOutcome;
  try {
    outcome = await capture(job, attempt);
  } catch (error) {
    const retryable = parseScreenshotRetryableError(error);
    if (!retryable) {
      if (!(error instanceof Error && error.name === "NonRetryableError")) {
        await recordStage(job, stageFailed(Date.now(), "screenshot_error"));
      }
      throw error;
    }
    if (
      !options.lastAttempt &&
      attempt <= SCREENSHOT_RETRY_POLICY[retryable.type].maxRetries
    ) {
      throw error;
    }
    console.warn("[screenshot] Failed", {
      cardId: job.cardId,
      type: retryable.type,
    });
    await recordStage(job, stageFailed(Date.now(), retryable.type));
    return { reason: retryable.type, status: "failed" };
  }
  if (outcome.status === "failed") {
    await recordStage(job, stageFailed(Date.now(), outcome.reason));
  } else {
    await recordStage(job, stageCompleted(Date.now()));
  }
  return outcome;
};
