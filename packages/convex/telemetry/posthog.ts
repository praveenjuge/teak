import { env } from "../_generated/server";
import type { ServerEventCatalog, ServerEventName } from "../shared/analytics";
import {
  createPostHogBatch,
  type PostHogBatch,
  type PostHogProperties,
} from "../shared/posthog";
import {
  ignoreTelemetryErrorAsync,
  normalizeErrorClass,
  normalizeTelemetryAttributes,
  type TelemetryAttributes,
  type TelemetryOperation,
  type TelemetryStage,
  type TelemetrySurface,
} from "../shared/telemetry";

const BACKEND_LIB = "teak-backend";
const APP_VERSION_LENGTH = 12;

interface TelemetryScope {
  batch: PostHogBatch;
  cardId?: string;
  depth: number;
  workflowId?: string;
}

// A Convex isolate (or Node action process) runs one function invocation at a
// time, so module state is effectively per-invocation. Nested helpers share
// the outermost scope and its single flush.
let activeScope: TelemetryScope | undefined;
const capturedErrors = new WeakSet<object>();

const readToken = (): string | undefined =>
  env.POSTHOG_PROJECT_TOKEN?.trim() || undefined;

const appVersion = (): string | undefined =>
  env.CONVEX_GIT_COMMIT_SHA?.trim().slice(0, APP_VERSION_LENGTH) || undefined;

const createBatch = (): PostHogBatch =>
  createPostHogBatch({
    lib: BACKEND_LIB,
    platform: "node:javascript",
    token: readToken(),
  });

const baseProperties = (): PostHogProperties => {
  const version = appVersion();
  return { surface: "backend", ...(version ? { $app_version: version } : {}) };
};

const enqueue = async (
  record: (batch: PostHogBatch) => void
): Promise<void> => {
  if (!readToken()) {
    return;
  }
  await ignoreTelemetryErrorAsync(async () => {
    if (activeScope) {
      record(activeScope.batch);
      return;
    }
    const batch = createBatch();
    record(batch);
    await batch.flush();
  });
};

/** Groups every capture inside `callback` into one request at its end. */
export const withBackendTelemetryScope = async <T>(
  context: { cardId?: string; workflowId?: string },
  callback: () => Promise<T>
): Promise<T> => {
  const scope = activeScope ?? {
    batch: createBatch(),
    cardId: context.cardId,
    depth: 0,
    workflowId: context.workflowId,
  };
  activeScope = scope;
  scope.depth += 1;
  try {
    return await callback();
  } finally {
    scope.depth -= 1;
    if (scope.depth === 0) {
      if (activeScope === scope) {
        activeScope = undefined;
      }
      await scope.batch.flush();
    }
  }
};

export const captureBackendEvent = <Name extends ServerEventName>(
  event: Name,
  distinctId: string | undefined,
  properties: ServerEventCatalog[Name],
  options: { set?: PostHogProperties } = {}
): Promise<void> =>
  enqueue((batch) =>
    batch.capture({
      distinctId,
      event,
      properties: { ...baseProperties(), ...properties },
      set: options.set,
    })
  );

export const captureBackendException = (
  error: unknown,
  input: { distinctId?: string; properties?: TelemetryAttributes } = {}
): Promise<void> => {
  if (error && typeof error === "object") {
    if (capturedErrors.has(error)) {
      return Promise.resolve();
    }
    capturedErrors.add(error);
  }
  return enqueue((batch) =>
    batch.captureException(error, {
      distinctId: input.distinctId,
      properties: {
        ...baseProperties(),
        ...normalizeTelemetryAttributes(input.properties),
        "error.class": normalizeErrorClass(error),
      },
    })
  );
};

export const isRetryableBackendError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /retry|waiting|not yet|no (?:object|output) generated|failed to validate json|response did not match schema|rate.?limit|too many requests|tokens per (?:day|minute)|\b(?:tpd|tpm|429)\b/iu.test(
    message
  );
};

export interface BackendCaptureInput {
  attributes?: TelemetryAttributes;
  cardId?: string;
  name: string;
  operation: TelemetryOperation;
  stage?: TelemetryStage;
  surface: TelemetrySurface;
  userId?: string;
  workflowId?: string;
}

/**
 * Runs an action body, reports a non-retryable failure, and rethrows it.
 * Retryable failures stay quiet: workflow retries own them.
 */
export const withBackendErrorCapture = <T>(
  input: BackendCaptureInput,
  callback: () => Promise<T>
): Promise<T> =>
  withBackendTelemetryScope(input, async () => {
    try {
      return await callback();
    } catch (error) {
      if (!isRetryableBackendError(error)) {
        await captureBackendException(error, {
          distinctId: input.userId,
          properties: {
            ...input.attributes,
            "card.id": input.cardId,
            name: input.name,
            operation: input.operation,
            stage: input.stage,
            "workflow.id": input.workflowId,
          },
        });
      }
      throw error;
    }
  });
