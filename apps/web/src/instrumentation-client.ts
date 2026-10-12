// Runs before the app is interactive, so keep it tiny: posthog-js itself
// loads later, when the page is idle (see lib/posthog-client.ts).
import { configureAnalytics } from "@teak/convex/shared/analytics";
import { configureClientTelemetry } from "@teak/convex/shared/client-telemetry";
import { startPostHog, withPostHog } from "./lib/posthog-client";

startPostHog(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN);

configureAnalytics({
  capture: (event, properties) =>
    withPostHog((posthog) => posthog.capture(event, properties)),
});

configureClientTelemetry({
  captureException: (error, attributes) =>
    withPostHog((posthog) => posthog.captureException(error, attributes)),
});
