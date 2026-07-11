import * as Sentry from "@sentry/electron/renderer";
import { configureClientTelemetry } from "@teak/convex/shared/client-telemetry";
import {
  configureMetrics,
  counter,
  distribution,
} from "@teak/convex/shared/metrics";
import {
  normalizeErrorClass,
  TELEMETRY_METRICS,
  type TelemetryAttributeValue,
} from "@teak/convex/shared/telemetry";
import {
  desktopTracesSampler,
  resolveDesktopEnvironment,
  resolveDesktopUserId,
  scrubDesktopPayload,
} from "./sentry-config";

const environment = resolveDesktopEnvironment(
  import.meta.env.VITE_SENTRY_ENVIRONMENT,
  import.meta.env.MODE
);
const startupStartedAt = Date.now();

const isSpanAttribute = (
  entry: [string, TelemetryAttributeValue]
): entry is [string, string | number | boolean] =>
  ["string", "number", "boolean"].includes(typeof entry[1]);

Sentry.init({
  _experiments: { enableMetrics: true },
  beforeSend: scrubDesktopPayload,
  beforeSendLog: scrubDesktopPayload,
  beforeSendSpan: scrubDesktopPayload,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],
  sendDefaultPii: false,
  tracesSampler: (context) => desktopTracesSampler(context, environment),
});

Sentry.setTag("surface", "desktop");
Sentry.setTag("packaged", String(!import.meta.env.DEV));

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

configureClientTelemetry({
  addBreadcrumb: ({ attributes, category, level, message }) => {
    Sentry.addBreadcrumb({ category, data: attributes, level, message });
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

export const finishDesktopStartup = (): void => {
  const durationMs = Date.now() - startupStartedAt;
  counter(TELEMETRY_METRICS.desktopStartup, 1, { outcome: "success" });
  distribution(
    TELEMETRY_METRICS.desktopStartup,
    durationMs,
    { outcome: "success" },
    "millisecond"
  );
  Sentry.logger.info("desktop.startup.completed", {
    "duration.ms": durationMs,
  });
};

export const setDesktopSentryUser = async (
  deviceId: string | null | undefined,
  authenticated: boolean
): Promise<void> => {
  const id = await resolveDesktopUserId(deviceId);
  Sentry.setUser(id ? { id } : null);
  Sentry.setContext("account", { authenticated });
};

const DEVICE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const syncDesktopSentryUser = async (
  authenticated: boolean
): Promise<void> => {
  try {
    const stored = await window.teakDesktop.store.read<string>("auth.deviceId");
    const deviceId =
      typeof stored === "string" && DEVICE_ID_PATTERN.test(stored)
        ? stored
        : crypto.randomUUID();
    if (deviceId !== stored) {
      await window.teakDesktop.store.write("auth.deviceId", deviceId);
    }
    await setDesktopSentryUser(deviceId, authenticated);
  } catch (error) {
    try {
      Sentry.captureException(error, {
        tags: {
          "error.class": normalizeErrorClass(error),
          operation: "desktop.user.sync",
        },
      });
    } catch {
      // Telemetry failures must not create renderer rejections.
      return;
    }
  }
};

if (typeof window !== "undefined" && window.teakDesktop) {
  void window.teakDesktop.app.getVersion().then((appVersion) => {
    Sentry.setContext("desktop", {
      appVersion,
      packaged: !import.meta.env.DEV,
      updateChannel: import.meta.env.VITE_DESKTOP_UPDATE_CHANNEL ?? "stable",
    });
    Sentry.setTag("app.version", appVersion);
    Sentry.setTag(
      "desktop.update_channel",
      import.meta.env.VITE_DESKTOP_UPDATE_CHANNEL ?? "stable"
    );
  });
}
