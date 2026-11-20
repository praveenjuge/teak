import { filesOpErrorCode, isTransientFilesOpCode } from "@teak/files-protocol";
import { env } from "../_generated/server";
import packageJson from "../package.json";
import type { ServerEventCatalog, ServerEventName } from "../shared/analytics";
import {
  BACKEND_POSTHOG_LIB,
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

const COMMIT_SHA_LENGTH = 12;

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

export const isBackendCaptureEnabled = (): boolean => Boolean(readToken());

// `$app_version` is the lockstep release version every surface reports, so
// one insight compares versions across them; the deploy's commit rides
// beside it.
export const BACKEND_APP_VERSION = packageJson.version;

export const backendCommitSha = (): string | undefined =>
  env.CONVEX_GIT_COMMIT_SHA?.trim().slice(0, COMMIT_SHA_LENGTH) || undefined;

/**
 * Whether an account is the team's own or a test account, for the
 * `is_internal` person property: Teak's E2E accounts (`e2e-…`) and every
 * entry of `POSTHOG_INTERNAL_ACCOUNTS`, a comma-separated list of addresses
 * and `@domain`s.
 */
export const isInternalAccount = (email: string | undefined): boolean => {
  const address = email?.trim().toLowerCase();
  if (!address) {
    return false;
  }
  if (address.startsWith("e2e-")) {
    return true;
  }
  const domain = address.slice(address.lastIndexOf("@"));
  return (env.POSTHOG_INTERNAL_ACCOUNTS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .some(
      (entry) =>
        entry === address || (entry.startsWith("@") && entry === domain)
    );
};

const createBatch = (): PostHogBatch =>
  createPostHogBatch({
    lib: BACKEND_POSTHOG_LIB,
    platform: "node:javascript",
    token: readToken(),
  });

const baseProperties = (): PostHogProperties => {
  const commitSha = backendCommitSha();
  return {
    $app_version: BACKEND_APP_VERSION,
    surface: "backend",
    ...(commitSha ? { commit_sha: commitSha } : {}),
  };
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

/** Sets person properties without a product event (PostHog's `$set`). */
export const setBackendPersonProperties = (
  distinctId: string,
  set: PostHogProperties
): Promise<void> =>
  enqueue((batch) =>
    batch.capture({ distinctId, event: "$set", properties: {}, set })
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
  const code = filesOpErrorCode(error);
  if (code) {
    return isTransientFilesOpCode(code);
  }
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
