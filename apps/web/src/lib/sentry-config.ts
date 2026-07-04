import type { ErrorEvent, EventHint } from "@sentry/nextjs";

const EXTENSION_FRAME_PREFIXES = [
  "app:///scripts/",
  "chrome-extension://",
  "moz-extension://",
  "safari-web-extension://",
];

export function resolveSentryEnvironment() {
  if (process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT) {
    return process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT;
  }

  if (process.env.SENTRY_ENVIRONMENT) {
    return process.env.SENTRY_ENVIRONMENT;
  }

  if (process.env.VERCEL_ENV) {
    return `vercel-${process.env.VERCEL_ENV}`;
  }

  return process.env.NODE_ENV ?? "development";
}

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

export function filterClientSentryEvent(event: ErrorEvent, _hint?: EventHint) {
  if (isExtensionFetchFailure(event)) {
    return null;
  }

  return event;
}
