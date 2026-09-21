import type {
  TelemetryAttributes,
  TelemetryOperation,
  TelemetryOutcome,
  TelemetryStage,
} from "./telemetry";
import { normalizeErrorClass, normalizeTelemetryAttributes } from "./telemetry";

export interface ClientSpanInput {
  attributes?: TelemetryAttributes;
  name: string;
  operation: TelemetryOperation;
  stage?: TelemetryStage;
}

export interface ClientTelemetryRecorder {
  addBreadcrumb?: (input: {
    attributes: TelemetryAttributes;
    category: string;
    level: "info" | "warning" | "error";
    message: string;
  }) => void;
  captureException?: (error: unknown, attributes: TelemetryAttributes) => void;
  log?: (
    level: "info" | "warning" | "error",
    message: string,
    attributes: TelemetryAttributes
  ) => void;
  startSpan?: <T>(
    input: ClientSpanInput,
    callback: () => Promise<T>
  ) => Promise<T>;
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

export const addTelemetryBreadcrumb = (input: {
  attributes?: TelemetryAttributes;
  category: string;
  level?: "info" | "warning" | "error";
  message: string;
}): void => {
  if (!activeRecorder.addBreadcrumb) {
    return;
  }
  safeTelemetryCall(() => {
    activeRecorder.addBreadcrumb?.({
      attributes: normalizeTelemetryAttributes(input.attributes),
      category: input.category,
      level: input.level ?? "info",
      message: input.message,
    });
  });
};

export const logClientTelemetry = (
  level: "info" | "warning" | "error",
  message: string,
  attributes: TelemetryAttributes = {}
): void => {
  if (!activeRecorder.log) {
    return;
  }
  safeTelemetryCall(() => {
    activeRecorder.log?.(
      level,
      message,
      normalizeTelemetryAttributes(attributes)
    );
  });
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

export const runClientSpan = async <T>(
  input: ClientSpanInput,
  callback: () => Promise<T>
): Promise<T> => {
  const spanRecorder = activeRecorder.startSpan;
  if (!spanRecorder) {
    return await callback();
  }
  let callbackStarted = false;
  const normalizedInput = {
    ...input,
    attributes: normalizeTelemetryAttributes({
      ...input.attributes,
      stage: input.stage,
    }),
  };
  try {
    return await spanRecorder(normalizedInput, async () => {
      callbackStarted = true;
      return await callback();
    });
  } catch (error) {
    if (callbackStarted) {
      throw error;
    }
    return await callback();
  }
};

export const recordClientOutcome = (input: {
  attributes?: TelemetryAttributes;
  category: string;
  message: string;
  outcome: TelemetryOutcome;
}): void => {
  const level = input.outcome === "failure" ? "error" : "info";
  const attributes = { ...input.attributes, outcome: input.outcome };
  addTelemetryBreadcrumb({
    attributes,
    category: input.category,
    level,
    message: input.message,
  });
  logClientTelemetry(level, input.message, attributes);
};
