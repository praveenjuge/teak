import { configureAnalytics } from "@teak/convex/shared/analytics";
import { configureClientTelemetry } from "@teak/convex/shared/clientTelemetry";
import { startPostHog, withPostHog } from "./lib/posthog-client";
import { releaseProperties } from "./lib/posthog-config";

startPostHog(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
  releaseProperties({
    commitSha: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
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
