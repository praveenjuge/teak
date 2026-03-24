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
