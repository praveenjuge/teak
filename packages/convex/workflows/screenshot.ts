import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { workflow } from "./manager";
import {
  SCREENSHOT_RETRYABLE_PREFIX,
  type ScreenshotRetryableError,
} from "./steps/screenshot/captureScreenshot";

const internalWorkflow = internal as Record<string, any>;

export const SCREENSHOT_RATE_LIMIT_MAX_RETRIES = 3;
export const SCREENSHOT_HTTP_MAX_RETRIES = 1;
export const SCREENSHOT_RATE_LIMIT_DELAY_MS = 15_000;
export const SCREENSHOT_HTTP_RETRY_DELAY_MS = 5_000;

export const parseScreenshotRetryableError = (
  error: unknown,
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

export const screenshotWorkflow = workflow.define({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.object({
    success: v.boolean(),
    errorType: v.optional(v.string()),
  }),
  handler: async (step, { cardId }) => {
    let retryCount = 0;
    let nextDelayMs: number | undefined;

    for (; ;) {
      const schedulerOptions =
        nextDelayMs !== undefined
          ? ({ runAfter: nextDelayMs } as const)
          : undefined;
      nextDelayMs = undefined;

      try {
        await step.runAction(
          internalWorkflow["workflows/steps/screenshot/captureScreenshot"]
            .captureScreenshot,
          { cardId, retryCount },
          schedulerOptions,
        );

        return { success: true };
      } catch (error) {
        const retryable = parseScreenshotRetryableError(error);
        if (!retryable) {
          throw error;
        }

        if (
          retryable.type === "rate_limit" &&
          retryCount < SCREENSHOT_RATE_LIMIT_MAX_RETRIES
        ) {
          nextDelayMs = SCREENSHOT_RATE_LIMIT_DELAY_MS;
          retryCount += 1;
          continue;
        }

        if (
          retryable.type === "http_error" &&
          retryCount < SCREENSHOT_HTTP_MAX_RETRIES
        ) {
          nextDelayMs = SCREENSHOT_HTTP_RETRY_DELAY_MS;
          retryCount += 1;
          continue;
        }

        console.warn(`[screenshot] Failed for card ${cardId}`, retryable.type);

        return {
          success: false,
          errorType: retryable.type,
        };
      }
    }
  },
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
    const workflowId = await workflow.start(
      ctx,
      internalWorkflow["workflows/screenshot"].screenshotWorkflow,
      { cardId },
      { startAsync: startAsync ?? false },
    );

    return { workflowId };
  },
});
