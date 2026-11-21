import { waitUntil } from "cloudflare:workers";
import {
  createServerEntry,
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { createPostHogBatch } from "@teak/convex/shared/posthog";
import packageJson from "../package.json" with { type: "json" };
import { releaseProperties, resolvePostHogToken } from "./lib/posthog-config";
import { withSecurityHeaders } from "./server/securityHeaders";

const handle = createStartHandler(defaultStreamHandler);

// Reports a request the app failed to answer to PostHog, after the response.
function reportRequestError(error: unknown, request: Request) {
  const batch = createPostHogBatch({
    lib: "teak-web-server",
    libVersion: packageJson.version,
    platform: "workers:javascript",
    token: resolvePostHogToken({
      analyticsEnabled: process.env.TEAK_ANALYTICS_ENABLED,
      token: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
    }),
  });
  if (!batch.enabled) {
    return;
  }
  batch.captureException(error, {
    handled: false,
    properties: {
      ...releaseProperties({
        commitSha: process.env.NEXT_PUBLIC_COMMIT_SHA,
        version: packageJson.version,
      }),
      method: request.method,
      route: new URL(request.url).pathname,
      surface: "web",
    },
  });
  waitUntil(batch.flush());
}

export default createServerEntry({
  fetch: async (request) => {
    try {
      return withSecurityHeaders(await handle(request));
    } catch (error) {
      reportRequestError(error, request);
      throw error;
    }
  },
});
