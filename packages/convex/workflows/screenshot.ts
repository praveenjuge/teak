import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import {
  type ProcessingStageStatus,
  stageCompleted,
  stageFailed,
  stagePending,
} from "../card/processingStatus";
import { startWorkflow, workflow } from "./manager";
import {
  SCREENSHOT_RETRYABLE_PREFIX,
  type ScreenshotRetryableError,
} from "./steps/screenshot/retryable";

const internalWorkflow = internal as Record<string, any>;

export const SCREENSHOT_RENDERER_MAX_RETRIES = 3;
export const SCREENSHOT_RENDERER_RETRY_DELAY_MS = 30_000;
export const SCREENSHOT_HTTP_MAX_RETRIES = 1;
export const SCREENSHOT_HTTP_RETRY_DELAY_MS = 5000;

const RETRY_POLICY: Record<
  ScreenshotRetryableError["type"],
  { delayMs: number; maxRetries: number }
> = {
  http_error: {
    delayMs: SCREENSHOT_HTTP_RETRY_DELAY_MS,
    maxRetries: SCREENSHOT_HTTP_MAX_RETRIES,
  },
  renderer_unavailable: {
    delayMs: SCREENSHOT_RENDERER_RETRY_DELAY_MS,
    maxRetries: SCREENSHOT_RENDERER_MAX_RETRIES,
  },
};

export const parseScreenshotRetryableError = (
  error: unknown
): ScreenshotRetryableError | null => {
  if (!(error instanceof Error) || typeof error.message !== "string") {
    return null;
  }
  if (!error.message.startsWith(SCREENSHOT_RETRYABLE_PREFIX)) {
    return null;
  }
  const payload = error.message.slice(SCREENSHOT_RETRYABLE_PREFIX.length);
  try {
    return JSON.parse(payload) as ScreenshotRetryableError;
  } catch {
    return null;
  }
};

interface ScreenshotStep {
  runAction: (
    reference: any,
    args: Record<string, unknown>,
    options?: { runAfter: number }
  ) => Promise<any>;
  runMutation: (reference: any, args: Record<string, unknown>) => Promise<any>;
}

export const screenshotWorkflowHandler = async (
  step: ScreenshotStep,
  { cardId }: { cardId: string }
): Promise<{ errorType?: string; success: boolean }> => {
  // The stage lives beside the card's other stages; the mutation merges it
  // into the status it reads, so a parallel stage is never reset.
  const recordStage = (screenshot: ProcessingStageStatus) =>
    step.runMutation(internalWorkflow.ai.mutations.updateCardProcessing, {
      cardId,
      processingStatus: { screenshot },
    });
  await recordStage(stagePending());

  let retryCount = 0;
  let nextDelayMs: number | undefined;
  for (;;) {
    const schedulerOptions =
      nextDelayMs === undefined
        ? undefined
        : ({ runAfter: nextDelayMs } as const);
    nextDelayMs = undefined;

    let outcome: { reason?: string; status: string };
    try {
      outcome = await step.runAction(
        internalWorkflow["workflows/steps/screenshot/captureScreenshot"]
          .captureScreenshot,
        { cardId, retryCount },
        schedulerOptions
      );
    } catch (error) {
      const retryable = parseScreenshotRetryableError(error);
      if (!retryable) {
        await recordStage(stageFailed(Date.now(), "screenshot_error"));
        throw error;
      }
      const policy = RETRY_POLICY[retryable.type];
      if (policy && retryCount < policy.maxRetries) {
        nextDelayMs = policy.delayMs;
        retryCount += 1;
        continue;
      }
      console.warn(`[screenshot] Failed for card ${cardId}`, retryable.type);
      await recordStage(stageFailed(Date.now(), retryable.type));
      return { success: false, errorType: retryable.type };
    }

    if (outcome.status === "failed") {
      await recordStage(
        stageFailed(Date.now(), outcome.reason ?? "screenshot_failed")
      );
      return { success: false, errorType: outcome.reason };
    }
    await recordStage(stageCompleted(Date.now()));
    return { success: true };
  }
};

export const screenshotWorkflow = workflow.define({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.object({
    success: v.boolean(),
    errorType: v.optional(v.string()),
  }),
  handler: (step, args) => screenshotWorkflowHandler(step, args),
});

export const startScreenshotWorkflow = internalMutation({
  args: {
    cardId: v.id("cards"),
    startAsync: v.optional(v.boolean()),
  },
  returns: v.object({
    workflowId: v.string(),
  }),
  handler: async (ctx, { cardId, startAsync }) => {
    const workflowId = await startWorkflow(
      ctx,
      internalWorkflow["workflows/screenshot"].screenshotWorkflow,
      { cardId },
      { startAsync: startAsync ?? false }
    );

    return { workflowId };
  },
});
