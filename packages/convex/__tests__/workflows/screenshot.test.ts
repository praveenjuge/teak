import { describe, expect, test } from "bun:test";
import { parseScreenshotRetryableError } from "../../workflows/screenshot";
import { SCREENSHOT_RETRYABLE_PREFIX } from "../../workflows/steps/screenshot/retryable";

// Mirrors how captureScreenshot signals a retryable failure to the workflow.
const retryableError = (payload: unknown) =>
  new Error(`${SCREENSHOT_RETRYABLE_PREFIX}${JSON.stringify(payload)}`);

describe("workflows/screenshot parseScreenshotRetryableError", () => {
  test("recovers the payload thrown by the capture step", () => {
    const payload = {
      type: "http_error",
      message: "Service unavailable",
      details: { statusCode: 503 },
    };

    expect(parseScreenshotRetryableError(retryableError(payload))).toEqual(
      payload
    );
  });

  test("recognizes rate limits so the workflow can back off", () => {
    expect(
      parseScreenshotRetryableError(retryableError({ type: "rate_limit" }))
    ).toEqual({ type: "rate_limit" });
  });

  test.each([
    ["a non-Error value", "workflow:screenshot:retryable:{}"],
    ["null", null],
    ["undefined", undefined],
    ["an ordinary error", new Error("socket hang up")],
    [
      "a prefixed error with malformed JSON",
      new Error(`${SCREENSHOT_RETRYABLE_PREFIX}{not json`),
    ],
  ])("treats %s as non-retryable", (_label: string, error: unknown) => {
    expect(parseScreenshotRetryableError(error)).toBeNull();
  });
});
