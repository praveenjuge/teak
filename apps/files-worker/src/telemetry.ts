import { createPostHogBatch } from "@teak/convex/shared/posthog";
import { parseCardObjectKey } from "@teak/files-protocol";
import packageJson from "../package.json";

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
  const { cardId, role } = parseCardObjectKey(objectKey);
  return sendException(env, ctx, error, {
    ...(cardId ? { "card.id": cardId } : {}),
    "files.op": op,
    "http.method": httpMethod.toUpperCase(),
    "http.path": bounded(httpPath),
    ...(objectKey ? { "object.key": bounded(objectKey) } : {}),
    ...(role ? { "object.role": role } : {}),
  });
};

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
