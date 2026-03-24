import Constants from "expo-constants";
import PostHog from "posthog-react-native";

const apiKey = Constants.expoConfig?.extra?.posthogProjectToken as
  | string
  | undefined;
const host = Constants.expoConfig?.extra?.posthogHost as string | undefined;
const isPostHogConfigured = Boolean(apiKey);

export const posthog = new PostHog(apiKey || "placeholder_key", {
  host,
  disabled: !isPostHogConfigured,
  captureNativeAppLifecycleEvents: true,
  flushAt: 20,
  flushInterval: 10_000,
});

// Register super properties to identify the mobile app as the source
if (isPostHogConfigured) {
  posthog.register({
    teak_source: "mobile",
    teak_version: "1.0.25",
  });
}
