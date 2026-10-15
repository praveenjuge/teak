import { describe, expect, test } from "bun:test";
import {
  parseScreenshotRetryableError,
  SCREENSHOT_RENDERER_MAX_RETRIES,
  SCREENSHOT_RENDERER_RETRY_DELAY_MS,
  screenshotWorkflowHandler,
} from "../../workflows/screenshot";
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
    } as const;

    expect(parseScreenshotRetryableError(retryableError(payload))).toEqual(
      payload
    );
  });

  test("recognizes a busy renderer so the workflow can back off", () => {
    expect(
      parseScreenshotRetryableError(
        retryableError({ type: "renderer_unavailable" })
      )
    ).toEqual({ type: "renderer_unavailable" });
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

describe("screenshot stage", () => {
  const fakeStep = (answers: unknown[]) => {
    const stages: Array<{ error?: string; status: string }> = [];
    const delays: Array<number | undefined> = [];
    return {
      delays,
      stages,
      step: {
        runAction: (
          _ref: unknown,
          _args: unknown,
          options?: { runAfter: number }
        ) => {
          delays.push(options?.runAfter);
          const answer = answers.shift();
          return answer instanceof Error
            ? Promise.reject(answer)
            : Promise.resolve(answer);
        },
        runMutation: (_ref: unknown, args: any) => {
          stages.push(args.processingStatus.screenshot);
          return Promise.resolve(true);
        },
      },
    };
  };

  test("goes from pending to completed", async () => {
    const { stages, step } = fakeStep([{ status: "captured" }]);

    expect(await screenshotWorkflowHandler(step, { cardId: "c1" })).toEqual({
      success: true,
    });
    expect(stages.map((stage) => stage.status)).toEqual([
      "pending",
      "completed",
    ]);
  });

  test("records a declined page as failed with its reason", async () => {
    const { stages, step } = fakeStep([
      { reason: "not_html", status: "failed" },
    ]);

    expect(await screenshotWorkflowHandler(step, { cardId: "c1" })).toEqual({
      errorType: "not_html",
      success: false,
    });
    expect(stages[stages.length - 1]).toMatchObject({
      error: "not_html",
      status: "failed",
    });
  });

  test("retries a busy renderer, then fails quietly", async () => {
    const busy = retryableError({ type: "renderer_unavailable" });
    const { delays, stages, step } = fakeStep(
      Array.from({ length: SCREENSHOT_RENDERER_MAX_RETRIES + 1 }, () => busy)
    );

    expect(await screenshotWorkflowHandler(step, { cardId: "c1" })).toEqual({
      errorType: "renderer_unavailable",
      success: false,
    });
    expect(delays).toEqual([
      undefined,
      ...Array.from(
        { length: SCREENSHOT_RENDERER_MAX_RETRIES },
        () => SCREENSHOT_RENDERER_RETRY_DELAY_MS
      ),
    ]);
    expect(stages.map((stage) => stage.status)).toEqual(["pending", "failed"]);
  });

  test("succeeds when the renderer frees up", async () => {
    const { stages, step } = fakeStep([
      retryableError({ type: "renderer_unavailable" }),
      { status: "captured" },
    ]);

    expect(await screenshotWorkflowHandler(step, { cardId: "c1" })).toEqual({
      success: true,
    });
    expect(stages[stages.length - 1]?.status).toBe("completed");
  });

  test("records an unexpected error as failed and rethrows it", async () => {
    const { stages, step } = fakeStep([new Error("boom")]);

    await expect(
      screenshotWorkflowHandler(step, { cardId: "c1" })
    ).rejects.toThrow("boom");
    expect(stages[stages.length - 1]).toMatchObject({
      error: "screenshot_error",
      status: "failed",
    });
  });
});
