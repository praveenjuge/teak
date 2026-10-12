// Error reporting for the files worker: errors only, no tracing or logs.
// Events go to PostHog with the shared fetch helper, one request per failure,
// sent after the response through waitUntil. Without POSTHOG_PROJECT_TOKEN
// (development, tests) nothing is sent.

import { createPostHogBatch } from "@teak/convex/shared/posthog";
import packageJson from "../package.json";

/** Env vars backing error reporting; set in production only. */
export interface TelemetryEnvVars {
  POSTHOG_PROJECT_TOKEN?: string;
}

interface WaitUntil {
  waitUntil: (promise: Promise<unknown>) => void;
}

const createWorkerBatch = (env: TelemetryEnvVars) =>
  createPostHogBatch({
    lib: "teak-files-worker",
    libVersion: packageJson.version,
    platform: "node:javascript",
    token: env.POSTHOG_PROJECT_TOKEN,
  });

/** Sends one exception, after the response when a context is available. */
const sendException = async (
  env: TelemetryEnvVars,
  ctx: WaitUntil | undefined,
  error: unknown,
  properties: Record<string, unknown>
): Promise<void> => {
  const batch = createWorkerBatch(env);
  if (!batch.enabled) {
    return;
  }
  batch.captureException(error, {
    properties: {
      ...properties,
      $app_version: packageJson.version,
      surface: "files-worker",
    },
  });
  const sent = batch.flush();
  if (ctx) {
    ctx.waitUntil(sent);
    return;
  }
  await sent;
};

export interface FileKeyIdentifiers {
  cardId?: string;
  role?: string;
}

/**
 * Best-effort card/role extraction from an R2 object key. Keys minted by
 * buildR2ObjectKey (packages/convex/storage/r2.ts) look like
 * users/<user-hash>/cards/<cardId|pending>/<role>/<uuid>-<name>; anything
 * else parses to no identifiers instead of guessing.
 */
export const parseFileKeyIdentifiers = (key: string): FileKeyIdentifiers => {
  const rawSegments = key.split("/");
  const segments =
    rawSegments[0] === "dev" ? rawSegments.slice(1) : rawSegments;
  if (
    segments.length < 5 ||
    segments[0] !== "users" ||
    segments[2] !== "cards"
  ) {
    return {};
  }
  const [cardId, role] = [segments[3], segments[4]];
  return {
    ...(cardId && cardId !== "pending" ? { cardId } : {}),
    ...(role ? { role } : {}),
  };
};

export interface FilesOpFailureContext {
  httpMethod: string;
  httpPath: string;
  objectKey: string;
}

const MAX_CONTEXT_STRING_LENGTH = 256;

const bounded = (value: string): string =>
  value.length <= MAX_CONTEXT_STRING_LENGTH
    ? value
    : value.slice(0, MAX_CONTEXT_STRING_LENGTH);

/**
 * Explicit capture for op failures that handleOp already converted into 500
 * responses. They never escape fetch(), so the unhandled-error capture in
 * index.ts cannot see them.
 */
export const reportFilesOpFailure = (
  env: TelemetryEnvVars,
  ctx: WaitUntil | undefined,
  op: string,
  error: unknown,
  { httpMethod, httpPath, objectKey }: FilesOpFailureContext
): Promise<void> => {
  const { cardId, role } = parseFileKeyIdentifiers(objectKey);
  return sendException(env, ctx, error, {
    ...(cardId ? { "card.id": cardId } : {}),
    "files.op": op,
    "http.method": httpMethod.toUpperCase(),
    "http.path": bounded(httpPath),
    ...(objectKey ? { "object.key": bounded(objectKey) } : {}),
    ...(role ? { "object.role": role } : {}),
  });
};

/** Reports an error that escaped the fetch handler, then lets it propagate. */
export const reportUnhandledError = (
  env: TelemetryEnvVars,
  ctx: WaitUntil,
  error: unknown,
  request: Request
): Promise<void> =>
  sendException(env, ctx, error, {
    "http.method": request.method.toUpperCase(),
    "http.path": bounded(new URL(request.url).pathname),
  });
