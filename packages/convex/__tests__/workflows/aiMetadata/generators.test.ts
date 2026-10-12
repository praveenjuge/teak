// @ts-nocheck
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { configureMetrics, resetMetricsConfig } from "../../../shared/metrics";
import { TELEMETRY_METRICS } from "../../../shared/telemetry";

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
    global.fetch = (_url, request) => {
      ops.push(JSON.parse(request.body as string).op);
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
    };
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
    const names = ["FILES_BASE", "FILES_SIGNING_SECRET"];
    const previous = names.map((name) => process.env[name]);
    process.env.FILES_BASE = "https://files.teakvault.com";
    process.env.FILES_SIGNING_SECRET = "test-secret";
    const metrics: Array<{ name: string; value: number }> = [];
    const record = (name: string, value: number) => {
      metrics.push({ name, value });
    };
    configureMetrics({
      recorder: { count: record, distribution: record, gauge: record },
    });
    const calls: string[] = [];
    const fetchBefore = global.fetch;
    global.fetch = (_url, request) => {
      const body = JSON.parse(request.body as string);
      calls.push(body.op);
      expect(body.params.prompt.length).toBe(maxInputChars);
      expect(request.headers["x-teak-signature"]).toMatch(/^[a-f0-9]{64}$/);
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
    };
    try {
      const oversized = "x".repeat(maxInputChars * 2);
      expect(await generateTextMetadata(oversized, "Title")).toEqual({
        aiTags: ["design"],
        aiSummary: "Useful.",
      });
      expect(
        await generateLinkMetadata(oversized, "https://example.com")
      ).toEqual({ aiTags: ["design"], aiSummary: "Useful." });
      expect(
        metrics.filter((metric) => metric.name === TELEMETRY_METRICS.aiCalls)
      ).toHaveLength(2);
      expect(
        metrics.filter((metric) => metric.name === TELEMETRY_METRICS.aiLatency)
      ).toHaveLength(2);
      expect(
        metrics.filter((metric) => metric.name === TELEMETRY_METRICS.aiCostUsd)
      ).toHaveLength(2);
      expect(
        metrics
          .filter((metric) => metric.name === TELEMETRY_METRICS.aiTokensInput)
          .map((metric) => metric.value)
      ).toEqual([18, 18]);
      expect(
        metrics
          .filter((metric) => metric.name === TELEMETRY_METRICS.aiTokensOutput)
          .map((metric) => metric.value)
      ).toEqual([7, 7]);
      expect(
        metrics.filter((metric) => metric.name === TELEMETRY_METRICS.aiRetries)
      ).toHaveLength(2);
      expect(calls).toEqual([
        "generate-text-metadata",
        "generate-link-metadata",
      ]);
    } finally {
      resetMetricsConfig();
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
      const names = ["FILES_BASE", "FILES_SIGNING_SECRET"];
      const previous = names.map((name) => process.env[name]);
      const fetchBefore = global.fetch;
      const metrics: Array<{
        name: string;
        value: number;
        attributes: Record<string, unknown>;
      }> = [];
      const record = (
        name: string,
        value: number,
        attributes: Record<string, unknown>
      ) => {
        metrics.push({ name, value, attributes });
      };
      configureMetrics({
        recorder: { count: record, distribution: record, gauge: record },
      });
      process.env.FILES_BASE = "https://files.teakvault.com";
      process.env.FILES_SIGNING_SECRET = "test-secret";
      global.fetch = () =>
        Promise.resolve(
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
      try {
        let failure: unknown;
        try {
          await generateTextMetadata("Text");
        } catch (error) {
          failure = error;
        }
        expect(
          metrics.filter((metric) => metric.name === TELEMETRY_METRICS.aiCalls)
        ).toMatchObject([{ attributes: { outcome: "failure" } }]);
        expect(
          metrics.filter(
            (metric) => metric.name === TELEMETRY_METRICS.aiLatency
          )
        ).toHaveLength(1);
        if (code !== "MALFORMED_SUCCESS" && code !== "UNSUPPORTED") {
          expect(
            metrics
              .filter(
                (metric) => metric.name === TELEMETRY_METRICS.aiTokensInput
              )
              .map((metric) => metric.value)
          ).toEqual([24]);
          expect(
            metrics
              .filter(
                (metric) => metric.name === TELEMETRY_METRICS.aiTokensOutput
              )
              .map((metric) => metric.value)
          ).toEqual([6]);
          expect(
            metrics.filter(
              (metric) => metric.name === TELEMETRY_METRICS.aiCostUsd
            )
          ).toHaveLength(1);
          expect(
            metrics.filter(
              (metric) => metric.name === TELEMETRY_METRICS.aiRetries
            )
          ).toHaveLength(2);
        }
        if (code === "UNSUPPORTED") {
          for (const name of [
            TELEMETRY_METRICS.aiTokensInput,
            TELEMETRY_METRICS.aiTokensOutput,
            TELEMETRY_METRICS.aiCostUsd,
            TELEMETRY_METRICS.aiRetries,
          ]) {
            expect(
              metrics.filter((metric) => metric.name === name)
            ).toHaveLength(0);
          }
        }
        expect(failure).toBeInstanceOf(Error);
        expect(isAiMetadataDeferredError(failure)).toBe(true);
        expect(isAiProviderCapacityError(failure)).toBe(capacity);
      } finally {
        resetMetricsConfig();
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
