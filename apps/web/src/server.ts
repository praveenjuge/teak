import { env, waitUntil } from "cloudflare:workers";
import {
  createServerEntry,
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { createPostHogBatch } from "@teak/convex/shared/posthog";
import packageJson from "../package.json" with { type: "json" };
import { releaseProperties, resolvePostHogToken } from "./lib/posthog-config";
import { proxyAnalytics } from "./server/analyticsProxy";
import { createNonce, withSecurityHeaders } from "./server/securityHeaders";

const handle = createStartHandler(defaultStreamHandler);

// Reports a request the app failed to answer to PostHog, after the response.
function reportRequestError(error: unknown, request: Request) {
  const batch = createPostHogBatch({
    lib: "teak-web-server",
    libVersion: packageJson.version,
    platform: "workers:javascript",
    // Read from the environment, not a hard-coded token.
    // nosemgrep: codacy.yaml.security.hard-coded-tokens
    token: resolvePostHogToken({
      analyticsEnabled: process.env.TEAK_ANALYTICS_ENABLED,
      // nosemgrep: codacy.yaml.security.hard-coded-tokens
      token: import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN,
    }),
  });
  if (!batch.enabled) {
    return;
  }
  batch.captureException(error, {
    handled: false,
    properties: {
      ...releaseProperties({
        commitSha: import.meta.env.VITE_PUBLIC_COMMIT_SHA,
        version: packageJson.version,
      }),
      method: request.method,
      route: new URL(request.url).pathname,
      surface: "web",
      // The Worker version that failed, as Workers Issues and traces show it.
      worker_version: env.CF_VERSION_METADATA?.id,
    },
  });
  waitUntil(batch.flush());
}

export default createServerEntry({
  fetch: async (request) => {
    try {
      // The PostHog proxy answers before the app runs: it never sits behind
      // sign-in, and its replies keep PostHog's own headers.
      const analytics = await proxyAnalytics(request);
      if (analytics) {
        return analytics;
      }
      const nonce = createNonce();
      const response = await handle(request, {
        context: { nonce },
        // Cloudflare turns a page's preload and preconnect `Link` headers
        // into 103 Early Hints for the next visit, so the stylesheet, font
        // and files host start loading before the page is rendered.
        responseLinkHeader: {
          filter: ({ hint }) =>
            hint.rel === "preload" || hint.rel === "preconnect",
        },
      });
      return withSecurityHeaders(response, nonce);
    } catch (error) {
      reportRequestError(error, request);
      throw error;
    }
  },
});
