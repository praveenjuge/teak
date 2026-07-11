import { describe, expect, test } from "bun:test";
import { TELEMETRY_METRICS } from "../../shared/telemetry";
import { resolveBillingTelemetry } from "../../telemetry/events";

describe("billing telemetry", () => {
  test("keeps customer portal outcomes separate from checkout", () => {
    expect(resolveBillingTelemetry("portal", "attempt")).toEqual({
      metric: TELEMETRY_METRICS.portalAttempt,
      stage: "portal",
    });
    expect(resolveBillingTelemetry("portal", "success")).toEqual({
      metric: TELEMETRY_METRICS.portalSuccess,
      stage: "portal",
    });
    expect(resolveBillingTelemetry("portal", "failure")).toEqual({
      metric: TELEMETRY_METRICS.portalFailure,
      stage: "portal",
    });
  });

  test("preserves checkout outcome metrics", () => {
    expect(resolveBillingTelemetry("checkout", "attempt")).toEqual({
      metric: TELEMETRY_METRICS.checkoutStart,
      stage: "checkout",
    });
    expect(resolveBillingTelemetry("checkout", "success")).toEqual({
      metric: TELEMETRY_METRICS.checkoutSuccess,
      stage: "checkout",
    });
  });
});
