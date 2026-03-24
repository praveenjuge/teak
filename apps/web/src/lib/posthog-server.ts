import { PostHog } from "posthog-node";

let posthogClient: PostHog | null = null;

export function getPostHogClient() {
  if (!posthogClient) {
    posthogClient = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
    });

    // Register super properties for server-side events
    posthogClient.register({
      teak_source: "web",
      teak_version: "1.0.25",
    });
  }
  return posthogClient;
}
