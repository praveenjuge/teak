import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  captureBackendEvent,
  withBackendErrorCapture,
} from "../../telemetry/posthog";
import { asFetch } from "../helpers/convex.test-utils";

const originalFetch = globalThis.fetch;
const originalToken = process.env.POSTHOG_PROJECT_TOKEN;
let fetchMock: ReturnType<typeof mock>;

const sentEvents = () =>
  fetchMock.mock.calls.flatMap(([, init]) => JSON.parse(init.body).batch);

const input = {
  cardId: "card_1",
  name: "card.ai_metadata",
  operation: "gen_ai.generate",
  stage: "ai_metadata",
  surface: "backend",
  userId: "teak_user_1",
} as const;

beforeEach(() => {
  fetchMock = mock(async () => Response.json({ status: 1 }));
  globalThis.fetch = asFetch(fetchMock);
  process.env.POSTHOG_PROJECT_TOKEN = "phc_test";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) {
    delete process.env.POSTHOG_PROJECT_TOKEN;
  } else {
    process.env.POSTHOG_PROJECT_TOKEN = originalToken;
  }
});

describe("backend PostHog capture", () => {
  test("sends nothing without a project token", async () => {
    delete process.env.POSTHOG_PROJECT_TOKEN;
    await captureBackendEvent("card_created", "teak_user_1", {
      card_type: "link",
      source: "web",
    });
    await expect(
      withBackendErrorCapture(input, () => Promise.reject(new Error("boom")))
    ).rejects.toThrow("boom");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("groups an action's events into one request at its end", async () => {
    await withBackendErrorCapture(input, async () => {
      await captureBackendEvent("card_processing_completed", undefined, {
        card_type: "link",
        duration_ms: 10,
      });
      await withBackendErrorCapture({ ...input, name: "nested" }, () =>
        captureBackendEvent("card_created", "teak_user_1", {
          card_type: "link",
          source: "web",
        })
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentEvents().map((event) => event.event)).toEqual([
      "card_processing_completed",
      "card_created",
    ]);
  });

  test("reports a failure once, owned by the user, and rethrows it", async () => {
    const failure = new Error("files_worker_error:INTERNAL:500:req_1");
    await expect(
      withBackendErrorCapture(input, () =>
        withBackendErrorCapture({ ...input, name: "inner" }, () =>
          Promise.reject(failure)
        )
      )
    ).rejects.toBe(failure);

    const events = sentEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      distinct_id: "teak_user_1",
      event: "$exception",
      properties: {
        $lib: "teak-backend",
        "card.id": "card_1",
        operation: "gen_ai.generate",
        stage: "ai_metadata",
      },
    });
  });

  test("leaves retryable failures to workflow retries", async () => {
    await expect(
      withBackendErrorCapture(input, () =>
        Promise.reject(new Error("files_worker_ai: rate limit reached 429"))
      )
    ).rejects.toThrow("rate limit");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("never lets a telemetry outage change the action result", async () => {
    globalThis.fetch = asFetch(
      mock(() => Promise.reject(new Error("offline")))
    );
    await expect(
      withBackendErrorCapture(input, async () => {
        await captureBackendEvent("billing_portal_opened", "teak_user_1", {});
        return "done";
      })
    ).resolves.toBe("done");
  });
});
