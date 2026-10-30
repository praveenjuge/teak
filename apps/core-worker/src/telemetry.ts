import {
  BACKEND_POSTHOG_LIB,
  createPostHogBatch,
} from "@teak/convex/shared/posthog";
import {
  type AnalyticsEventItem,
  FILES_OP_PATH,
  parseCardObjectKey,
} from "@teak/files-protocol";
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

/**
 * Sends Convex's queued analytics events in one `/batch/` request, as
 * Convex's own capture would (`$lib: teak-backend`). A failed request is
 * tried once more; each event's UUID keeps PostHog from counting it twice.
 */
export const sendBackendEvents = async (
  env: TelemetryEnvVars,
  events: AnalyticsEventItem[]
): Promise<boolean> => {
  if (events.length === 0 || !env.POSTHOG_PROJECT_TOKEN) {
    return false;
  }
  const send = () => {
    const batch = createPostHogBatch({
      lib: BACKEND_POSTHOG_LIB,
      platform: "node:javascript",
      token: env.POSTHOG_PROJECT_TOKEN,
    });
    for (const item of events) {
      batch.capture({
        distinctId: item.distinctId,
        event: item.event,
        properties: {
          ...item.properties,
          ...(item.appVersion ? { $app_version: item.appVersion } : {}),
        },
        set: item.set,
        timestamp: item.timestamp,
        uuid: item.uuid,
      });
    }
    return batch.flush();
  };
  return (await send()) || (await send());
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
