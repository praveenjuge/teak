import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asFetch } from "../../helpers/convex.test-utils";

const aiEventsFrom = (url: string | URL | Request, request?: RequestInit) =>
  String(url).endsWith("/batch/")
    ? JSON.parse(String(request?.body)).batch.map(
        (event: { properties: Record<string, unknown> }) => event.properties
      )
    : null;

let generateTextMetadata: any;
let generateLinkMetadata: any;
let generateImageMetadataForStoredKey: any;
let boundAiMetadataInput: any;
let maxInputChars: number;
let isAiProviderCapacityError: any;
let isAiMetadataDeferredError: any;

describe("aiMetadata generators", () => {
  const originalFetch = global.fetch;

  beforeAll(async () => {
    const mod = await import("../../../workflows/aiMetadata/generators");
    generateTextMetadata = mod.generateTextMetadata;
    generateLinkMetadata = mod.generateLinkMetadata;
    generateImageMetadataForStoredKey = mod.generateImageMetadataForStoredKey;
    boundAiMetadataInput = mod.boundAiMetadataInput;
    maxInputChars = mod.MAX_AI_METADATA_INPUT_CHARS;
    isAiProviderCapacityError = mod.isAiProviderCapacityError;
    isAiMetadataDeferredError = mod.isAiMetadataDeferredError;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  test("keeps short metadata input unchanged", () => {
    expect(boundAiMetadataInput("short content")).toBe("short content");
  });

  test("bounds long metadata input while retaining both ends", () => {
    const content = `${"a".repeat(maxInputChars)}MIDDLE${"z".repeat(maxInputChars)}`;
    const bounded = boundAiMetadataInput(content);

    expect(bounded.length).toBe(maxInputChars);
    expect(bounded.startsWith("aaaa")).toBe(true);
    expect(bounded.endsWith("zzzz")).toBe(true);
    expect(bounded).toContain(
      `[Content truncated from ${content.length} characters]`
    );
    expect(bounded).not.toContain("MIDDLE");
  });

  test("detects provider capacity errors without treating validation as capacity", () => {
    expect(
      isAiProviderCapacityError(
        new Error("Rate limit reached on tokens per day (TPD), status code 429")
      )
    ).toBe(true);
    expect(
      isAiProviderCapacityError(
        new Error("No object generated: response did not match schema")
      )
    ).toBe(false);
    expect(isAiMetadataDeferredError(new Error("No output generated."))).toBe(
      true
    );
  });

  test("defers stored image metadata when the Worker cannot read a raster source", async () => {
    const previous = [process.env.FILES_BASE, process.env.FILES_SIGNING_SECRET];
    process.env.FILES_BASE = "https://files.teakvault.com";
    process.env.FILES_SIGNING_SECRET = "test-secret";
    const ops: string[] = [];
    global.fetch = asFetch((_url, request) => {
      ops.push(JSON.parse(String(request?.body)).op);
      return Promise.resolve(
        Response.json(
          {
            ok: false,
            version: 1,
            error: {
              code: "UNSUPPORTED",
              message: "Unsupported source",
              requestId: "test",
              retryable: false,
            },
          },
          { status: 501 }
        )
      );
    });
    try {
      let failure: unknown;
      try {
        await generateImageMetadataForStoredKey("users/u/cards/c/a.svg");
      } catch (error) {
        failure = error;
      }
      expect(ops).toEqual(["generate-image-metadata"]);
      expect((failure as Error).message).toContain("raster thumbnail");
      expect(isAiMetadataDeferredError(failure)).toBe(true);
    } finally {
      global.fetch = originalFetch;
      [process.env.FILES_BASE, process.env.FILES_SIGNING_SECRET] = previous;
      if (previous[0] === undefined) {
        delete process.env.FILES_BASE;
      }
      if (previous[1] === undefined) {
        delete process.env.FILES_SIGNING_SECRET;
      }
    }
  });

  test("routes text and link generation through signed Worker operations", async () => {
    const names = [
      "FILES_BASE",
      "FILES_SIGNING_SECRET",
      "POSTHOG_PROJECT_TOKEN",
    ];
    const previous = names.map((name) => process.env[name]);
    process.env.FILES_BASE = "https://files.teakvault.com";
    process.env.FILES_SIGNING_SECRET = "test-secret";
    process.env.POSTHOG_PROJECT_TOKEN = "phc_test";
    const aiEvents: Record<string, unknown>[] = [];
    const calls: string[] = [];
    const fetchBefore = global.fetch;
    global.fetch = asFetch((url, request) => {
      const reported = aiEventsFrom(url, request);
      if (reported) {
        aiEvents.push(...reported);
        return Promise.resolve(Response.json({ status: 1 }));
      }
      const body = JSON.parse(String(request?.body));
      calls.push(body.op);
      expect(body.params.prompt.length).toBe(maxInputChars);
      expect(new Headers(request?.headers).get("x-teak-signature")).toMatch(
        /^[a-f0-9]{64}$/
      );
      return Promise.resolve(
        Response.json({
          ok: true,
          version: 1,
          requestId: "test",
          data: {
            tags: ["design"],
            summary: "Useful.",
            validationRetryCount: 1,
            usage: { inputTokens: 18, outputTokens: 7 },
          },
        })
      );
    });
    try {
      const oversized = "x".repeat(maxInputChars * 2);
      expect(await generateTextMetadata(oversized, "Title")).toEqual({
        aiTags: ["design"],
        aiSummary: "Useful.",
      });
      expect(
        await generateLinkMetadata(oversized, "https://example.com")
      ).toEqual({ aiTags: ["design"], aiSummary: "Useful." });
      expect(aiEvents).toMatchObject([
        {
          $ai_input_tokens: 18,
          $ai_is_error: false,
          $ai_model: expect.any(String),
          $ai_output_tokens: 7,
          $ai_provider: "cloudflare",
          $ai_span_name: "teak.ai.metadata.text",
          $ai_total_cost_usd: expect.any(Number),
        },
        { $ai_span_name: "teak.ai.metadata.link" },
      ]);
      expect(aiEvents[0]?.$ai_latency).toBeGreaterThanOrEqual(0);
      expect(JSON.stringify(aiEvents)).not.toContain("Useful.");
      expect(calls).toEqual([
        "generate-text-metadata",
        "generate-link-metadata",
      ]);
    } finally {
      global.fetch = fetchBefore;
      names.forEach((name, index) => {
        if (previous[index] === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = previous[index];
        }
      });
    }
  });
  test.each([
    { code: "AI_CAPACITY", httpStatus: 429, capacity: true },
    { code: "AI_INVALID_OUTPUT", httpStatus: 502, capacity: false },
    { code: "MALFORMED_SUCCESS", httpStatus: 200, capacity: false },
    { code: "UNSUPPORTED", httpStatus: 501, capacity: false },
  ])(
    "keeps Worker $code errors deferred",
    async ({ code, httpStatus, capacity }) => {
      const names = [
        "FILES_BASE",
        "FILES_SIGNING_SECRET",
        "POSTHOG_PROJECT_TOKEN",
      ];
      const previous = names.map((name) => process.env[name]);
      const fetchBefore = global.fetch;
      const aiEvents: Record<string, unknown>[] = [];
      process.env.FILES_BASE = "https://files.teakvault.com";
      process.env.FILES_SIGNING_SECRET = "test-secret";
      process.env.POSTHOG_PROJECT_TOKEN = "phc_test";
      global.fetch = asFetch((url, request) => {
        const reported = aiEventsFrom(url, request);
        if (reported) {
          aiEvents.push(...reported);
          return Promise.resolve(Response.json({ status: 1 }));
        }
        return Promise.resolve(
          Response.json(
            code === "MALFORMED_SUCCESS"
              ? {
                  ok: true,
                  version: 1,
                  data: { tags: [42], summary: "Invalid" },
                }
              : {
                  ok: false,
                  version: 1,
                  error: {
                    code,
                    message: "Worker failed",
                    requestId: "test",
                    retryable: true,
                    aiFacts: {
                      validationRetryCount: 2,
                      usage: { inputTokens: 24, outputTokens: 6 },
                    },
                  },
                },
            { status: httpStatus }
          )
        );
      });
      try {
        let failure: unknown;
        try {
          await generateTextMetadata("Text");
        } catch (error) {
          failure = error;
        }
        expect(aiEvents).toMatchObject([{ $ai_is_error: true }]);
        if (code === "AI_CAPACITY" || code === "AI_INVALID_OUTPUT") {
          expect(aiEvents[0]).toMatchObject({
            $ai_input_tokens: 24,
            $ai_output_tokens: 6,
            $ai_total_cost_usd: expect.any(Number),
          });
        } else {
          expect(aiEvents[0]?.$ai_input_tokens).toBeUndefined();
        }
        expect(failure).toBeInstanceOf(Error);
        expect(isAiMetadataDeferredError(failure)).toBe(true);
        expect(isAiProviderCapacityError(failure)).toBe(capacity);
      } finally {
        global.fetch = fetchBefore;
        names.forEach((name, index) => {
          if (previous[index] === undefined) {
            delete process.env[name];
          } else {
            process.env[name] = previous[index];
          }
        });
      }
    }
  );
});
