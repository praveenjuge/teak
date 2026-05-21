import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";

const SentryClient = Sentry;

const resolveRelease = (): string | undefined => {
  const appVersion = Constants.expoConfig?.version;
  const runtimeVersion =
    typeof Constants.expoConfig?.runtimeVersion === "string"
      ? Constants.expoConfig.runtimeVersion
      : undefined;

  if (appVersion && runtimeVersion) {
    return `teak-mobile@${appVersion}+${runtimeVersion}`;
  }

  return appVersion ? `teak-mobile@${appVersion}` : undefined;
};

const resolveEnvironment = (): string =>
  process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ??
  process.env.NODE_ENV ??
  "development";

const dsn = process.env.EXPO_PUBLIC_SENTRY_MOBILE_DSN;

SentryClient.init({
  dsn,
  enabled: Boolean(dsn),
  environment: resolveEnvironment(),
  release: resolveRelease(),
  dist:
    Constants.expoConfig?.ios?.buildNumber ??
    Constants.expoConfig?.android?.versionCode?.toString(),
  tracesSampleRate: resolveEnvironment() === "production" ? 0.2 : 1,
  profilesSampleRate: resolveEnvironment() === "production" ? 0.1 : 1,
  enableAppStartTracking: true,
  enableNativeFramesTracking: true,
  enableStallTracking: true,
  enableUserInteractionTracing: true,
  enableCaptureFailedRequests: true,
  enableLogs: true,
  replaysSessionSampleRate: resolveEnvironment() === "production" ? 0.01 : 0,
  replaysOnErrorSampleRate: 1,
  sendDefaultPii: false,
});

SentryClient.setTag("surface", "mobile");
SentryClient.setTag("app", "teak");

export { SentryClient as Sentry };
