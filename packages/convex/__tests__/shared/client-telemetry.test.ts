import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  captureClientException,
  configureClientTelemetry,
  createClientRequestError,
  createClientRequestErrorFromContext,
  resetClientTelemetry,
} from "../../shared/client_telemetry";

afterEach(() => {
  resetClientTelemetry();
});

describe("client telemetry adapter", () => {
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

  test("preserves response context in request errors", () => {
    expect(
      createClientRequestErrorFromContext({
        error: { code: "INTERNAL_SERVER_ERROR", message: "Deletion failed" },
        response: { status: 500, statusText: "Internal Server Error" },
      })
    ).toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Deletion failed",
      status: 500,
      statusText: "Internal Server Error",
    });
  });

  test("uses the caller fallback when the server omits a message", () => {
    expect(
      createClientRequestErrorFromContext(
        { error: {}, response: { status: 500, statusText: "" } },
        "Failed to delete account."
      ).message
    ).toBe("Failed to delete account.");
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

  test("drops unsafe attribute keys and isolates capture failures", () => {
    const captureException = mock();
    configureClientTelemetry({ captureException });
    const error = new Error("boom");
    captureClientException(error, { "card.type": "link", "unsafe key": "x" });
    expect(captureException).toHaveBeenCalledWith(error, {
      "card.type": "link",
      "error.class": "UnknownError",
    });

    configureClientTelemetry({
      captureException: () => {
        throw new Error("capture failed");
      },
    });
    expect(() => captureClientException(error)).not.toThrow();
  });
});
