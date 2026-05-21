import * as Sentry from "@sentry/node";

const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV;
const release =
  process.env.SENTRY_RELEASE ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.npm_package_version;

Sentry.init({
  dsn: process.env.SENTRY_API_DSN,
  enabled: Boolean(process.env.SENTRY_API_DSN),
  environment,
  release,
  tracesSampleRate: environment === "production" ? 0.2 : 1,
  enableLogs: true,
  sendDefaultPii: false,
  integrations: [
    Sentry.honoIntegration(),
    Sentry.consoleLoggingIntegration(),
    Sentry.nodeContextIntegration(),
  ],
});

Sentry.setTag("app", "teak");
Sentry.setTag("surface", "api");
