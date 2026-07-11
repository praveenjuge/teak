// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { configureMetrics } from "@teak/convex/shared/metrics";
import {
  resolveSentryDsn,
  resolveSentryEnvironment,
  resolveSentryRelease,
  scrubSentryPayload,
  webTracesSampler,
} from "./src/lib/sentry-config";

Sentry.init({
  dsn: resolveSentryDsn(),
  environment: resolveSentryEnvironment(),
  release: resolveSentryRelease(),
  beforeSend: scrubSentryPayload,
  beforeSendLog: scrubSentryPayload,
  beforeSendSpan: scrubSentryPayload,

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampler: webTracesSampler,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  sendDefaultPii: false,
});

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
