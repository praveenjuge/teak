import * as Sentry from "@sentry/electron/main";
import { configureMetrics } from "@teak/convex/shared/metrics";
import type {
  TelemetryAttributes,
  TelemetryMetricName,
} from "@teak/convex/shared/telemetry";
import packageJson from "../../package.json";
import {
  desktopTracesSampler,
  resolveDesktopDsn,
  resolveDesktopEnvironment,
  resolveDesktopRelease,
  scrubDesktopPayload,
} from "../sentry-config";

const environment = resolveDesktopEnvironment(
  import.meta.env.VITE_SENTRY_ENVIRONMENT,
  import.meta.env.MODE
);
const release = resolveDesktopRelease(
  packageJson.version,
  import.meta.env.VITE_GIT_COMMIT_SHA,
  import.meta.env.VITE_SENTRY_RELEASE
);

Sentry.init({
  attachScreenshot: false,
  beforeSend: scrubDesktopPayload,
  beforeSendLog: scrubDesktopPayload,
  beforeSendSpan: scrubDesktopPayload,
  dsn: resolveDesktopDsn(import.meta.env.VITE_PUBLIC_SENTRY_DESKTOP_DSN),
  enableLogs: true,
  environment,
  integrations: [
    Sentry.rendererEventLoopBlockIntegration({ captureNativeStacktrace: true }),
    Sentry.startupTracingIntegration(),
  ],
  release,
  sendDefaultPii: false,
  tracesSampler: (context) => desktopTracesSampler(context, environment),
});

configureMetrics({
  app: "desktop",
  env: environment,
  recorder: {
    count: (name, value, attributes) =>
      Sentry.metrics.count(name, value, { attributes }),
    distribution: (name, value, attributes, unit) =>
      Sentry.metrics.distribution(name, value, { attributes, unit }),
    gauge: (name, value, attributes, unit) =>
      Sentry.metrics.gauge(name, value, { attributes, unit }),
  },
});

export const configureDesktopMainContext = (input: {
  appVersion: string;
  packaged: boolean;
  updateChannel: string;
}): void => {
  Sentry.setTags({
    "app.version": input.appVersion,
    "desktop.update_channel": input.updateChannel,
    packaged: input.packaged,
    surface: "desktop",
  });
  Sentry.setContext("desktop", input);
};

export const captureDesktopMainException = (
  error: unknown,
  operation: string,
  attributes: Record<string, unknown> = {}
): void => {
  Sentry.captureException(error, {
    extra: scrubDesktopPayload(attributes),
    tags: { operation, surface: "desktop" },
  });
};

export const logDesktopMain = (
  level: "info" | "warn" | "error",
  message: string,
  attributes: Record<string, unknown> = {}
): void => {
  Sentry.logger[level](message, scrubDesktopPayload(attributes));
};

export const recordDesktopMainCount = (
  name: TelemetryMetricName,
  attributes: TelemetryAttributes
): void => {
  Sentry.metrics.count(name, 1, { attributes });
};

export const recordDesktopMainDistribution = (
  name: TelemetryMetricName,
  value: number,
  attributes: TelemetryAttributes,
  unit: "millisecond" | "byte" | "none"
): void => {
  Sentry.metrics.distribution(name, value, { attributes, unit });
};
