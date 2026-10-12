import type { TelemetryAttributes } from "./telemetry";
import { normalizeErrorClass, normalizeTelemetryAttributes } from "./telemetry";

export interface ClientTelemetryRecorder {
  captureException?: (error: unknown, attributes: TelemetryAttributes) => void;
}

let activeRecorder: ClientTelemetryRecorder = {};

export const configureClientTelemetry = (
  recorder: ClientTelemetryRecorder
): void => {
  activeRecorder = recorder;
};

export const resetClientTelemetry = (): void => {
  activeRecorder = {};
};

const safeTelemetryCall = (callback: () => void): void => {
  try {
    callback();
  } catch {
    // Client telemetry must never alter the product flow.
  }
};

export interface ClientRequestErrorInput {
  code?: string;
  message: string;
  status?: number;
  statusText?: string;
}

export class ClientRequestError extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly statusText?: string;

  constructor({ code, message, status, statusText }: ClientRequestErrorInput) {
    super(message);
    this.name = "ClientRequestError";
    this.code = code;
    this.status = status;
    this.statusText = statusText;
  }
}

export const createClientRequestError = (
  input: ClientRequestErrorInput
): ClientRequestError => new ClientRequestError(input);

export const createClientRequestErrorFromContext = (
  context: {
    error?: { code?: unknown; message?: string } | null;
    response?: { status?: number; statusText?: string };
  },
  fallbackMessage = "Request failed."
): ClientRequestError =>
  createClientRequestError({
    code:
      typeof context.error?.code === "string" ? context.error.code : undefined,
    message: context.error?.message ?? fallbackMessage,
    status: context.response?.status,
    statusText: context.response?.statusText,
  });

const requestErrorTelemetryAttributes = (
  error: unknown
): TelemetryAttributes => {
  if (!(error instanceof ClientRequestError)) {
    return {};
  }
  return {
    "http.status_code": error.status,
    "http.status_text": error.statusText,
    "error.code": error.code,
  };
};

export const captureClientException = (
  error: unknown,
  attributes: TelemetryAttributes = {}
): void => {
  if (!activeRecorder.captureException) {
    return;
  }
  safeTelemetryCall(() => {
    activeRecorder.captureException?.(error, {
      ...normalizeTelemetryAttributes({
        ...requestErrorTelemetryAttributes(error),
        ...attributes,
      }),
      "error.class": normalizeErrorClass(error),
    });
  });
};
