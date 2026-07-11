import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  addTelemetryBreadcrumb,
  captureClientException,
  configureClientTelemetry,
  resetClientTelemetry,
  runClientSpan,
} from "../../shared/client_telemetry";
import { TELEMETRY_OPERATIONS } from "../../shared/telemetry";

afterEach(() => {
  resetClientTelemetry();
});

describe("client telemetry adapter", () => {
  test("does not alter outcomes when telemetry fails before a callback", async () => {
    const operation = mock(async () => "saved");
    configureClientTelemetry({
      startSpan: () => {
        throw new Error("telemetry unavailable");
      },
    });

    const result = await runClientSpan(
      {
        name: "card.save",
        operation: TELEMETRY_OPERATIONS.workflow,
      },
      operation
    );

    expect(result).toBe("saved");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  test("preserves application failures once the callback begins", async () => {
    const applicationError = new Error("save failed");
    configureClientTelemetry({
      startSpan: async (_input, callback) => await callback(),
    });

    await expect(
      runClientSpan(
        {
          name: "card.save",
          operation: TELEMETRY_OPERATIONS.workflow,
        },
        () => Promise.reject(applicationError)
      )
    ).rejects.toBe(applicationError);
  });

  test("bounds breadcrumb data and isolates capture failures", () => {
    const breadcrumb = mock();
    configureClientTelemetry({
      addBreadcrumb: breadcrumb,
      captureException: () => {
        throw new Error("capture failed");
      },
    });

    addTelemetryBreadcrumb({
      attributes: { "card.type": "link", "unsafe key": "drop" },
      category: "card",
      message: "saving",
    });
    expect(breadcrumb).toHaveBeenCalledWith({
      attributes: { "card.type": "link" },
      category: "card",
      level: "info",
      message: "saving",
    });
    expect(() => captureClientException(new Error("boom"))).not.toThrow();
  });
});
