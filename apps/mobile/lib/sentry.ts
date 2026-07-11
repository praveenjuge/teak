import * as Sentry from "@sentry/react-native";
import {
  configureClientTelemetry,
  recordClientOutcome,
} from "@teak/convex/shared/client-telemetry";
import { configureMetrics, trackAuth } from "@teak/convex/shared/metrics";
import type { TelemetryAttributeValue } from "@teak/convex/shared/telemetry";
import * as Application from "expo-application";
import Constants from "expo-constants";
import {
  mobileTracesSampler,
  resolveMobileDsn,
  resolveMobileEnvironment,
  resolveMobileRelease,
  resolvePseudonymousUserId,
  scrubMobilePayload,
} from "@/lib/sentry-config";

const SentryClient = Sentry;
const environment = resolveMobileEnvironment();
const appVersion =
  Application.nativeApplicationVersion ?? Constants.expoConfig?.version;
const buildNumber =
  Application.nativeBuildVersion ??
  Constants.expoConfig?.ios?.buildNumber ??
  Constants.expoConfig?.android?.versionCode;
const release = resolveMobileRelease(appVersion, buildNumber);
const startupStartedAt = Date.now();

const isSpanAttribute = (
  entry: [string, TelemetryAttributeValue]
): entry is [string, string | number | boolean] =>
  ["string", "number", "boolean"].includes(typeof entry[1]);

SentryClient.init({
  _experiments: {
    enableStandaloneAppStartTracing: true,
    profilingOptions: {
      lifecycle: "trace",
      profileSessionSampleRate: environment === "production" ? 0.1 : 1,
      startOnAppStart: true,
    },
  },
  appHangTimeoutInterval: 2,
  attachScreenshot: false,
  attachViewHierarchy: false,
  beforeSend: scrubMobilePayload,
  beforeSendLog: scrubMobilePayload,
  beforeSendSpan: scrubMobilePayload,
  dist: buildNumber?.toString(),
  dsn: resolveMobileDsn(),
  enableAppHangTracking: true,
  enableAppStartTracking: true,
  enableAutoSessionTracking: true,
  enableCaptureFailedRequests: true,
  enableLogs: true,
  enableNativeCrashHandling: true,
  enableNativeFramesTracking: true,
  enableStallTracking: true,
  enableUserInteractionTracing: true,
  enabled: Boolean(resolveMobileDsn()),
  environment,
  integrations: [
    SentryClient.consoleLoggingIntegration({ levels: ["warn", "error"] }),
    SentryClient.mobileReplayIntegration({
      maskAllImages: true,
      maskAllText: true,
      maskAllVectors: true,
      networkCaptureBodies: false,
    }),
  ],
  release,
  replaysSessionSampleRate: environment === "production" ? 0.01 : 0,
  replaysOnErrorSampleRate: 1,
  sendDefaultPii: false,
  tracesSampler: mobileTracesSampler,
});

SentryClient.setTag("surface", "mobile");
SentryClient.setTag("app", "teak");
SentryClient.setTag("packaged", String(!__DEV__));

configureMetrics({
  app: "mobile",
  env: environment,
  recorder: {
    count: (name, value, attributes) =>
      SentryClient.metrics.count(name, value, { attributes }),
    distribution: (name, value, attributes, unit) =>
      SentryClient.metrics.distribution(name, value, { attributes, unit }),
    gauge: (name, value, attributes, unit) =>
      SentryClient.metrics.gauge(name, value, { attributes, unit }),
  },
});

configureClientTelemetry({
  addBreadcrumb: ({ attributes, category, level, message }) => {
    SentryClient.addBreadcrumb({ category, data: attributes, level, message });
  },
  captureException: (error, attributes) => {
    SentryClient.captureException(error, { extra: attributes });
  },
  log: (level, message, attributes) => {
    if (level === "warning") {
      SentryClient.logger.warn(message, attributes);
      return;
    }
    SentryClient.logger[level](message, attributes);
  },
  startSpan: async (input, callback) =>
    await SentryClient.startSpan(
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

export const setMobileSentryUser = async (
  userId: string | null | undefined
): Promise<void> => {
  if (!userId) {
    SentryClient.setUser(null);
    SentryClient.setContext("account", null);
    return;
  }
  try {
    const id = await resolvePseudonymousUserId(userId);
    SentryClient.setUser({ id });
    SentryClient.setContext("account", { authenticated: true });
  } catch (error) {
    SentryClient.setUser(null);
    SentryClient.setContext("account", {
      authenticated: true,
      pseudonymousIdAvailable: false,
    });
    SentryClient.captureException(error, {
      tags: { operation: "mobile.auth.user_context" },
    });
  }
};

export const finishMobileStartup = (): void => {
  SentryClient.appLoaded();
  const durationMs = Date.now() - startupStartedAt;
  trackAuth({ durationMs, outcome: "success", stage: "bootstrap" });
  recordClientOutcome({
    attributes: { "duration.ms": durationMs },
    category: "mobile.startup",
    message: "mobile.startup.completed",
    outcome: "success",
  });
};

export { SentryClient as Sentry };
