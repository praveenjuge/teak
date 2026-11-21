// Starts PostHog and routes analytics and client errors to it. The client
// entry imports this before the app hydrates.
import { configureAnalytics } from "@teak/convex/shared/analytics";
import { configureClientTelemetry } from "@teak/convex/shared/clientTelemetry";
import { startPostHog, withPostHog } from "./posthog-client";
import { releaseProperties } from "./posthog-config";

startPostHog(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
  releaseProperties({
    commitSha: process.env.NEXT_PUBLIC_COMMIT_SHA,
    version: process.env.NEXT_PUBLIC_APP_VERSION,
  })
);

configureAnalytics({
  capture: (event, properties) =>
    withPostHog((posthog) => posthog.capture(event, properties)),
});

configureClientTelemetry({
  captureException: (error, attributes) =>
    withPostHog((posthog) => posthog.captureException(error, attributes)),
});
