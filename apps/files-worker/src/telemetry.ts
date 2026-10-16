import { createPostHogBatch } from "@teak/convex/shared/posthog";
import { FILES_OP_PATH, parseCardObjectKey } from "@teak/files-protocol";
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

const MAX_CONTEXT_STRING_LENGTH = 256;

const bounded = (value: string): string =>
  value.length <= MAX_CONTEXT_STRING_LENGTH
    ? value
    : value.slice(0, MAX_CONTEXT_STRING_LENGTH);

export const reportInternalOpError = (
  env: TelemetryEnvVars,
  ctx: WaitUntil | undefined,
  op: string,
  error: unknown,
  objectKey: string
): Promise<void> => {
  const { cardId, role } = parseCardObjectKey(objectKey);
  return sendException(env, ctx, error, {
    ...(cardId ? { "card.id": cardId } : {}),
    "files.op": op,
    "http.method": "POST",
    "http.path": FILES_OP_PATH,
    ...(objectKey ? { "object.key": bounded(objectKey) } : {}),
    ...(role ? { "object.role": role } : {}),
  });
};

export const reportUnhandledError = (
  env: TelemetryEnvVars,
  ctx: WaitUntil,
  error: unknown,
  request?: Request
): Promise<void> =>
  sendException(
    env,
    ctx,
    error,
    request
      ? {
          "http.method": request.method.toUpperCase(),
          "http.path": bounded(new URL(request.url).pathname),
        }
      : {}
  );

/** Reports an error from background work (a workflow step, queue or cron). */
export const reportBackgroundError = (
  env: TelemetryEnvVars,
  ctx: WaitUntil | undefined,
  error: unknown,
  context: { task: string; [key: string]: string | number | boolean }
): Promise<void> =>
  sendException(env, ctx, error, {
    ...Object.fromEntries(
      Object.entries(context).map(([key, value]) => [
        key,
        typeof value === "string" ? bounded(value) : value,
      ])
    ),
  });
