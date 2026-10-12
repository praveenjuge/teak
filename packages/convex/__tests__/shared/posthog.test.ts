import { describe, expect, mock, test } from "bun:test";
import {
  buildExceptionProperties,
  createPostHogBatch,
  POSTHOG_INGEST_HOST,
  parseStackFrames,
} from "../../shared/posthog";

const okFetch = () =>
  mock(async (_url: string | URL | Request, _init?: RequestInit) =>
    Response.json({ status: 1 })
  );

const sentBody = (fetch: ReturnType<typeof okFetch>) =>
  JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));

describe("PostHog batch", () => {
  test("never fetches without a project token", async () => {
    const fetch = okFetch();
    const batch = createPostHogBatch({ fetch, lib: "test", token: " " });
    batch.capture({ distinctId: "user_1", event: "card_created" });
    batch.captureException(new Error("boom"));

    expect(batch.enabled).toBe(false);
    expect(await batch.flush()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("sends every queued event in one batch request", async () => {
    const fetch = okFetch();
    const batch = createPostHogBatch({ fetch, lib: "teak-test", token: "phc" });
    batch.capture({
      distinctId: "user_1",
      event: "card_created",
      properties: { card_type: "link" },
      set: { email: "owner@example.com" },
    });
    batch.capture({ event: "card_processing_completed" });

    expect(await batch.flush()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(`${POSTHOG_INGEST_HOST}/batch/`);
    const body = sentBody(fetch);
    expect(body.api_key).toBe("phc");
    expect(body.batch).toHaveLength(2);
    expect(body.batch[0]).toMatchObject({
      distinct_id: "user_1",
      event: "card_created",
      properties: {
        $lib: "teak-test",
        $set: { email: "owner@example.com" },
        card_type: "link",
      },
    });
    // Ownerless events must not create a person.
    expect(body.batch[1].properties.$process_person_profile).toBe(false);
    expect(batch.size).toBe(0);
    expect(await batch.flush()).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("scrubs event properties but keeps person properties", async () => {
    const fetch = okFetch();
    const batch = createPostHogBatch({ fetch, lib: "test", token: "phc" });
    batch.capture({
      distinctId: "user_1",
      event: "signed_in",
      properties: { note: "contact owner@example.com", token: "secret" },
      set: { email: "owner@example.com" },
    });
    await batch.flush();

    const [event] = sentBody(fetch).batch;
    expect(event.properties.note).not.toContain("owner@example.com");
    expect(event.properties.token).toBe("[REDACTED]");
    expect(event.properties.$set.email).toBe("owner@example.com");
  });

  test("never throws when the network fails or hangs", async () => {
    const failing = createPostHogBatch({
      fetch: mock(() => Promise.reject(new Error("offline"))),
      lib: "test",
      token: "phc",
    });
    failing.capture({ event: "signed_in" });
    expect(await failing.flush()).toBe(false);

    const hanging = createPostHogBatch({
      fetch: mock(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new Error("aborted"))
            );
          })
      ),
      lib: "test",
      timeoutMs: 10,
      token: "phc",
    });
    hanging.capture({ event: "signed_in" });
    expect(await hanging.flush()).toBe(false);
  });
});

describe("PostHog exception events", () => {
  test("parses V8 and JavaScriptCore stacks with the crashing frame last", () => {
    const v8 = parseStackFrames(
      [
        "Error: boom",
        "    at save (https://app.teakvault.com/_next/static/chunks/app.js:10:5)",
        "    at https://app.teakvault.com/_next/static/chunks/main.js:2:1",
        "    at load (/var/task/node_modules/lib/index.js:1:1)",
      ].join("\n"),
      "web:javascript"
    );
    expect(v8.map((frame) => frame.function)).toEqual(["load", "?", "save"]);
    expect(v8[v8.length - 1]).toMatchObject({
      colno: 5,
      filename: "https://app.teakvault.com/_next/static/chunks/app.js",
      in_app: true,
      lineno: 10,
      platform: "web:javascript",
    });
    expect(v8[0]?.in_app).toBe(false);

    const jsc = parseStackFrames(
      "save@https://app.teakvault.com/app.js:3:7",
      "web:javascript"
    );
    expect(jsc).toHaveLength(1);
    expect(jsc[0]).toMatchObject({ colno: 7, function: "save", lineno: 3 });
  });

  test("parses hostile stack text in linear time", () => {
    const hostile = [
      `at ${"a (a".repeat(50_000)}`,
      `${"@a".repeat(50_000)}`,
      `${"\t".repeat(50_000)}at x`,
    ].join("\n");
    const startedAt = performance.now();
    expect(parseStackFrames(hostile, "web:javascript")).toEqual([]);
    expect(performance.now() - startedAt).toBeLessThan(200);
  });

  test("builds an exception list with causes and scrubbed messages", () => {
    const cause = new TypeError("fetch failed");
    const error = Object.assign(
      new Error("upload for owner@example.com failed"),
      { cause }
    );
    const properties = buildExceptionProperties(error, {
      handled: false,
      platform: "node:javascript",
      properties: { operation: "storage.upload" },
    });
    const list = properties.$exception_list as Record<string, unknown>[];

    expect(properties.operation).toBe("storage.upload");
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      mechanism: { handled: false, synthetic: false, type: "generic" },
      type: "Error",
    });
    expect(String(list[0]?.value)).not.toContain("owner@example.com");
    expect(list[1]).toMatchObject({
      mechanism: { type: "chained" },
      type: "TypeError",
      value: "fetch failed",
    });
  });

  test("captures thrown non-errors as synthetic exceptions", () => {
    const properties = buildExceptionProperties("plain failure", {
      platform: "web:javascript",
    });
    expect(properties.$exception_list).toEqual([
      {
        mechanism: { handled: true, synthetic: true, type: "generic" },
        type: "Error",
        value: "plain failure",
      },
    ]);
  });
});
