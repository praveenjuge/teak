/**
 * Shared retryable-error contract for the screenshot step.
 *
 * These live in their own module (no `"use node"`, no Node built-ins) so that
 * default-runtime workflow files can import the prefix/type WITHOUT statically
 * pulling the `"use node"` action file — and its Node-only imports — into the
 * Convex V8 isolate bundle.
 */

export type ScreenshotRetryableError = {
  type: "rate_limit" | "http_error";
  message?: string;
  details?: unknown;
};

export const SCREENSHOT_RETRYABLE_PREFIX = "workflow:screenshot:retryable:";
