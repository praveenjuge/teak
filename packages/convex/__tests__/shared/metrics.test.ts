import { afterEach, describe, expect, test } from "bun:test";
import {
  configureMetrics,
  type MetricAttributes,
  resetMetricsConfig,
  trackAiRetry,
  trackAiStage,
  trackAuth,
  trackUpload,
} from "../../shared/metrics";
import { TELEMETRY_METRICS } from "../../shared/telemetry";

afterEach(() => {
  resetMetricsConfig();
});

describe("trackAiStage", () => {
  test("records the canonical card.type attribute on stage duration", () => {
    const distributions: Array<{
      attributes: MetricAttributes;
      name: string;
    }> = [];

    configureMetrics({
      app: "convex",
      env: "test",
      recorder: {
        count() {
          // Not used by this duration-only assertion.
        },
        distribution(name, _value, attributes) {
          distributions.push({ attributes, name });
        },
        gauge() {
          // Not used by this duration-only assertion.
        },
      },
    });

    trackAiStage({
      cardType: "link",
      durationMs: 125,
      outcome: "ok",
      stage: "ai_metadata",
    });

    expect(distributions).toEqual([
      {
        attributes: {
          "card.type": "link",
          environment: "test",
          "error.class": null,
          outcome: "ok",
          stage: "ai_metadata",
          surface: "backend",
        },
        name: TELEMETRY_METRICS.workflowStageDuration,
      },
    ]);
  });

  test("counts skipped workflow stages without reporting a failure", () => {
    const counts: Array<{
      attributes: MetricAttributes;
      name: string;
      value: number;
    }> = [];

    configureMetrics({
      app: "convex",
      env: "production",
      recorder: {
        count(name, value, attributes) {
          counts.push({ attributes, name, value });
        },
        distribution() {
          // The duration distribution is covered above.
        },
        gauge() {
          // Not used by workflow stage metrics.
        },
      },
    });

    trackAiStage({
      durationMs: 0,
      outcome: "skipped",
      stage: "classification",
    });

    expect(counts).toEqual([
      {
        attributes: {
          "card.type": null,
          environment: "production",
          stage: "classification",
          surface: "backend",
        },
        name: TELEMETRY_METRICS.workflowSkip,
        value: 1,
      },
    ]);
  });
});

describe("trackAiRetry", () => {
  test("records a bounded validation retry", () => {
    const counts: Array<{
      attributes: MetricAttributes;
      name: string;
      value: number;
    }> = [];

    configureMetrics({
      app: "convex",
      env: "production",
      recorder: {
        count(name, value, attributes) {
          counts.push({ attributes, name, value });
        },
        distribution() {
          // Not used by retry metrics.
        },
        gauge() {
          // Not used by retry metrics.
        },
      },
    });

    trackAiRetry({
      model: "qwen/qwen3.6-27b",
      provider: "groq",
      reason: "validation",
    });

    expect(counts).toEqual([
      {
        attributes: {
          environment: "production",
          model: "qwen/qwen3.6-27b",
          provider: "groq",
          reason: "validation",
          surface: "backend",
        },
        name: TELEMETRY_METRICS.aiRetries,
        value: 1,
      },
    ]);
  });
});

describe("trackUpload", () => {
  test("records file bytes once on the successful terminal outcome", () => {
    const counts: Array<{ name: string; value: number }> = [];
    const distributions: Array<{
      attributes: MetricAttributes;
      name: string;
      value: number;
    }> = [];

    configureMetrics({
      app: "web",
      env: "production",
      recorder: {
        count(name, value) {
          counts.push({ name, value });
        },
        distribution(name, value, attributes) {
          distributions.push({ attributes, name, value });
        },
        gauge() {
          // Not used by upload lifecycle metrics.
        },
      },
    });

    for (const outcome of ["attempt", "failure", "success"] as const) {
      trackUpload({
        bytes: 512,
        durationMs: outcome === "attempt" ? undefined : 100,
        fileBucket: "small",
        outcome,
        source: "web",
      });
    }

    expect(counts).toEqual([
      { name: TELEMETRY_METRICS.uploadAttempts, value: 1 },
      { name: TELEMETRY_METRICS.uploadFailure, value: 1 },
    ]);
    expect(
      distributions.filter(({ name }) => name === TELEMETRY_METRICS.uploadBytes)
    ).toEqual([
      {
        attributes: {
          environment: "production",
          "file.bucket": "small",
          outcome: "success",
          source: "web",
          surface: "web",
        },
        name: TELEMETRY_METRICS.uploadBytes,
        value: 512,
      },
    ]);
  });
});

describe("trackAuth", () => {
  test("records the canonical authentication stage", () => {
    const counts: Array<{
      attributes: MetricAttributes;
      name: string;
    }> = [];

    configureMetrics({
      app: "web",
      env: "production",
      recorder: {
        count(name, _value, attributes) {
          counts.push({ attributes, name });
        },
        distribution() {
          // Not used by this count-only assertion.
        },
        gauge() {
          // Not used by authentication lifecycle metrics.
        },
      },
    });

    trackAuth({ outcome: "success", stage: "bootstrap" });

    expect(counts).toEqual([
      {
        attributes: {
          environment: "production",
          outcome: "success",
          stage: "auth_bootstrap",
          surface: "web",
        },
        name: TELEMETRY_METRICS.authBootstrap,
      },
    ]);
  });
});
