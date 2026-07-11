import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import {
  buildWebRelease,
  hashTelemetryId,
  resolveTelemetryEnvironment,
  resolveTraceSampleRate,
  scrubTelemetryValue,
  type TelemetryEnvironment,
} from "@teak/convex/shared/telemetry";

export interface PseudonymousSentryUser {
  id: string;
}

export const buildPseudonymousSentryUser = async (
  userId: string | undefined
): Promise<PseudonymousSentryUser | null> => {
  const id = await hashTelemetryId(userId);
  return id ? { id } : null;
};

const EXTENSION_FRAME_PREFIXES = [
  "app:///scripts/",
  "chrome-extension://",
  "moz-extension://",
  "safari-web-extension://",
];

export const resolveSentryEnvironment = (): TelemetryEnvironment =>
  resolveTelemetryEnvironment({
    explicit:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
      process.env.SENTRY_ENVIRONMENT,
    nodeEnvironment: process.env.NODE_ENV,
    vercelEnvironment: process.env.VERCEL_ENV,
  });

export const resolveSentryDsn = (): string | undefined =>
  (process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN)?.trim() ||
  undefined;

export const resolveSentryRelease = (): string | undefined =>
  process.env.NEXT_PUBLIC_SENTRY_RELEASE?.trim() ||
  process.env.SENTRY_RELEASE?.trim() ||
  buildWebRelease(
    process.env.NEXT_PUBLIC_APP_VERSION ?? process.env.npm_package_version,
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.GITHUB_SHA
  );

interface WebSamplingContext {
  attributes?: Record<string, unknown>;
  name: string;
}

export const webTracesSampler = ({
  attributes = {},
  name,
}: WebSamplingContext): number =>
  resolveTraceSampleRate({
    durationMs:
      typeof attributes["duration.ms"] === "number"
        ? attributes["duration.ms"]
        : undefined,
    environment: resolveSentryEnvironment(),
    name,
    operation:
      typeof attributes["sentry.op"] === "string"
        ? attributes["sentry.op"]
        : undefined,
    outcome:
      typeof attributes.outcome === "string" ? attributes.outcome : undefined,
  });

export const scrubSentryPayload = <T>(payload: T): T =>
  scrubTelemetryValue(payload) as T;

const isExtensionFrame = (filename?: string) =>
  Boolean(
    filename &&
      EXTENSION_FRAME_PREFIXES.some((prefix) => filename.startsWith(prefix))
  );

const isExtensionFetchFailure = (event: ErrorEvent) =>
  event.exception?.values?.some((exception) => {
    const isFetchFailure =
      exception.type === "TypeError" &&
      exception.value?.startsWith("Failed to fetch");

    return (
      isFetchFailure &&
      exception.stacktrace?.frames?.some((frame) =>
        isExtensionFrame(frame.filename)
      )
    );
  }) ?? false;

const isProductionE2eWebkitUser = (event: ErrorEvent) =>
  typeof event.user?.username === "string" &&
  event.user.username.startsWith("e2e-matrix-matrix-webkit-");

const isBetterAuthSessionFrame = (filename?: string) =>
  Boolean(
    filename &&
      (filename.includes("node_modules/@convex-dev/better-auth/") ||
        filename.includes("node_modules/better-auth/") ||
        filename.includes("node_modules/@better-fetch/fetch/") ||
        filename.includes("/_next/static/chunks/"))
  );

const isSafariBetterAuthLoadFailure = (event: ErrorEvent) =>
  isProductionE2eWebkitUser(event) &&
  (event.exception?.values?.some((exception) => {
    const isWebkitLoadFailure =
      exception.type === "TypeError" &&
      exception.value === "Load failed (app.teakvault.com)";

    return (
      isWebkitLoadFailure &&
      (exception.stacktrace?.frames?.some((frame) =>
        isBetterAuthSessionFrame(frame.filename)
      ) ??
        false)
    );
  }) ??
    false);

export function filterClientSentryEvent(event: ErrorEvent, _hint?: EventHint) {
  if (isExtensionFetchFailure(event) || isSafariBetterAuthLoadFailure(event)) {
    return null;
  }

  return scrubSentryPayload(event);
}
