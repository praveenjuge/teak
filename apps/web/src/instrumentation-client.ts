// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { configureClientTelemetry } from "@teak/convex/shared/client-telemetry";
import { configureMetrics } from "@teak/convex/shared/metrics";
import type { TelemetryAttributeValue } from "@teak/convex/shared/telemetry";
import {
  filterClientSentryEvent,
  resolveSentryDsn,
  resolveSentryEnvironment,
  resolveSentryRelease,
  scrubSentryPayload,
  webTracesSampler,
} from "./lib/sentry-config";

const isSpanAttribute = (
  entry: [string, TelemetryAttributeValue]
): entry is [string, string | number | boolean] =>
  ["string", "number", "boolean"].includes(typeof entry[1]);

Sentry.init({
  dsn: resolveSentryDsn(),
  environment: resolveSentryEnvironment(),
  release: resolveSentryRelease(),
  beforeSend: filterClientSentryEvent,
  beforeSendLog: scrubSentryPayload,
  beforeSendSpan: scrubSentryPayload,

  tracesSampler: webTracesSampler,
  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Teak attaches only a hashed user id through SentryUserManager.
  sendDefaultPii: false,

  replaysSessionSampleRate: 0.1, // This sets the sample rate at 10%. You may want to change it to 100% while in development and then sample at a lower rate in production.
  replaysOnErrorSampleRate: 1.0, // If you're not already sampling the entire session, change the sample rate to 100% when sampling sessions where errors occur.

  integrations: [
    // send console.log, console.warn, and console.error calls as logs to Sentry
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
    Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    Sentry.feedbackIntegration({
      // Additional SDK configuration goes in here, for example:
      colorScheme: "system",
      showBranding: false,
      enableScreenshot: false,
      showName: false,
      showEmail: false,
      themeLight: {
        accentBackground: "var(--primary)",
      },
      themeDark: {
        accentBackground: "var(--primary)",
      },
    }),
  ],
});

// Route the shared @teak metrics helpers to Sentry's Application Metrics API.
configureMetrics({
  app: "web",
  env: resolveSentryEnvironment(),
  recorder: {
    count: (name, value, attributes) =>
      Sentry.metrics.count(name, value, { attributes }),
    gauge: (name, value, attributes, unit) =>
      Sentry.metrics.gauge(name, value, { attributes, unit }),
    distribution: (name, value, attributes, unit) =>
      Sentry.metrics.distribution(name, value, { attributes, unit }),
  },
});

configureClientTelemetry({
  addBreadcrumb: ({ attributes, category, level, message }) => {
    Sentry.addBreadcrumb({
      category,
      data: attributes,
      level,
      message,
    });
  },
  captureException: (error, attributes) => {
    Sentry.captureException(error, { extra: attributes });
  },
  log: (level, message, attributes) => {
    if (level === "warning") {
      Sentry.logger.warn(message, attributes);
      return;
    }
    Sentry.logger[level](message, attributes);
  },
  startSpan: async (input, callback) =>
    await Sentry.startSpan(
      {
        attributes: Object.fromEntries(
          Object.entries(input.attributes ?? {}).filter(isSpanAttribute)
        ),
        name: input.name,
        op: input.operation,
      },
      callback
    ),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
