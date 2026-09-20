import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  addTelemetryBreadcrumb,
  captureClientException,
  configureClientTelemetry,
  createClientRequestError,
  createClientRequestErrorFromContext,
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

  test("records safe request failure diagnostics", () => {
    const captureException = mock();
    configureClientTelemetry({ captureException });
    const error = createClientRequestError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to delete account.",
      status: 500,
      statusText: "Internal Server Error",
    });

    captureClientException(error, { operation: "account.delete" });

    expect(captureException).toHaveBeenCalledWith(error, {
      "error.class": "NetworkError",
      "error.code": "INTERNAL_SERVER_ERROR",
      "http.status_code": 500,
      "http.status_text": "Internal Server Error",
      operation: "account.delete",
    });
  });

  test("handles request failures without an HTTP response", () => {
    expect(
      createClientRequestErrorFromContext({
        error: { message: "Failed to fetch" },
      })
    ).toMatchObject({
      message: "Failed to fetch",
      status: undefined,
      statusText: undefined,
    });
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
