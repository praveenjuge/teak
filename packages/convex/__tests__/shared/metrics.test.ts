import { afterEach, describe, expect, test } from "bun:test";
import {
  configureMetrics,
  type MetricAttributes,
  resetMetricsConfig,
  trackAiStage,
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
      stage: "link_metadata",
    });

    expect(distributions).toEqual([
      {
        attributes: {
          "card.type": "link",
          environment: "test",
          "error.class": null,
          outcome: "ok",
          stage: "link_metadata",
          surface: "backend",
        },
        name: TELEMETRY_METRICS.workflowStageDuration,
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
