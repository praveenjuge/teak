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

export const captureClientException = (
  error: unknown,
  attributes: TelemetryAttributes = {}
): void => {
  if (!activeRecorder.captureException) {
    return;
  }
  safeTelemetryCall(() => {
    activeRecorder.captureException?.(error, {
      ...normalizeTelemetryAttributes(attributes),
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
