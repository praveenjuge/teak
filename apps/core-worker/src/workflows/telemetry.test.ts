import { afterEach, describe, expect, test } from "bun:test";
import { NonRetryableError } from "cloudflare:workflows";
import {
  emitCardProcessingCompleted,
  isRetryableBackgroundError,
  reportedStep,
} from "./telemetry";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const capturePostHog = () => {
  const events: Array<{ event: string; properties: Record<string, unknown> }> =
    [];
  globalThis.fetch = ((_url: RequestInfo | URL, init?: RequestInit) => {
    events.push(...JSON.parse(String(init?.body)).batch);
    return Promise.resolve(Response.json({ status: 1 }));
  }) as typeof fetch;
  return events;
};

// A test fixture value, not a real token.
// nosemgrep: codacy.yaml.security.hard-coded-tokens
const ENV = { POSTHOG_PROJECT_TOKEN: "phc_test" };

describe("card processing completion", () => {
  test("sends card_processing_completed with the type and duration", async () => {
    const events = capturePostHog();
    await emitCardProcessingCompleted(ENV, {
      cardType: "link",
      durationMs: 4200,
    });
    expect(events).toMatchObject([
      {
        event: "card_processing_completed",
        properties: {
          $lib: "teak-files-worker",
          card_type: "link",
          duration_ms: 4200,
          surface: "files-worker",
        },
      },
    ]);
  });

  test("adds the language AI wrote in, when there is one", async () => {
    const events = capturePostHog();
    await emitCardProcessingCompleted(ENV, {
      aiLanguage: "ja",
      cardType: "text",
      durationMs: 900,
    });
    await emitCardProcessingCompleted(ENV, {
      cardType: "image",
      durationMs: 1,
    });
    expect(events.map((event) => event.properties.ai_language)).toEqual([
      "ja",
      undefined,
    ]);
  });

  test("sends nothing without a project token", async () => {
    const events = capturePostHog();
    await emitCardProcessingCompleted({}, { cardType: "text", durationMs: 1 });
    expect(events).toEqual([]);
  });
});

describe("reportedStep", () => {
  const step = (error: Error) =>
    reportedStep(
      ENV,
      {
        cardId: "c1",
        maxAttempts: 3,
        name: "card.renderables",
        stage: "renderables",
      },
      () => Promise.reject(error)
    );

  test("reports an error once the step's last attempt fails", async () => {
    const events = capturePostHog();
    const failing = step(new Error("thumbnail_write_failed"));
    await expect(failing({ attempt: 2 })).rejects.toThrow();
    expect(events).toEqual([]);
    await expect(failing({ attempt: 3 })).rejects.toThrow();
    expect(events).toMatchObject([
      {
        event: "$exception",
        properties: {
          "card.id": "c1",
          stage: "renderables",
          task: "card-processing",
        },
      },
    ]);
  });

  test("reports an error that never retries at once", async () => {
    const events = capturePostHog();
    await expect(
      step(new NonRetryableError("bad_input"))({ attempt: 1 })
    ).rejects.toThrow("bad_input");
    expect(events).toHaveLength(1);
  });

  test.each([
    "files_worker_ai: rate limit reached 429",
    "stale_processing_revision:card/processingRpc:markStagesInProgress",
    "workflow:linkMetadata:retryable:{}",
  ])("keeps %s quiet: a retry or the backfill owns it", async (message) => {
    const events = capturePostHog();
    expect(isRetryableBackgroundError(new Error(message))).toBe(true);
    await expect(step(new Error(message))({ attempt: 3 })).rejects.toThrow();
    expect(events).toEqual([]);
  });
});
