// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { configureMetrics } from "@teak/convex/shared/metrics";
import { resolveSentryEnvironment } from "./src/lib/sentry-config";

Sentry.init({
  dsn: "https://9206eebecdbbbd9229ddc419b82165c7@o4509483678236672.ingest.us.sentry.io/4510434608480256",
  environment: resolveSentryEnvironment(),

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,

  integrations: [
    // send console.log, console.warn, and console.error calls as logs to Sentry
    Sentry.consoleLoggingIntegration(),
  ],
});

configureMetrics({
  app: "web",
  env: process.env.NODE_ENV ?? "development",
  recorder: {
    count: (name, value, attributes) =>
      Sentry.metrics.count(name, value, { attributes }),
    gauge: (name, value, attributes, unit) =>
      Sentry.metrics.gauge(name, value, { attributes, unit }),
    distribution: (name, value, attributes, unit) =>
      Sentry.metrics.distribution(name, value, { attributes, unit }),
  },
});
