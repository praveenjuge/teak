import { afterEach, describe, expect, test } from "bun:test";
import {
  configureMetrics,
  type MetricAttributes,
  resetMetricsConfig,
  trackAiStage,
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
      stage: "metadata",
    });

    expect(distributions).toEqual([
      {
        attributes: {
          "card.type": "link",
          environment: "test",
          "error.class": null,
          outcome: "ok",
          stage: "metadata",
          surface: "backend",
        },
        name: TELEMETRY_METRICS.workflowStageDuration,
      },
    ]);
  });
});
