import { env, waitUntil } from "cloudflare:workers";
import { createPostHogBatch } from "@teak/convex/shared/posthog";
import { releaseProperties } from "@/lib/posthog-config";
import packageJson from "../../package.json" with { type: "json" };

/**
 * Reports an error the Worker failed to handle to PostHog, after the
 * response. Only an analytics-enabled build carries a token
 * (vite.config.ts), so other builds send nothing.
 */
export function reportServerError(error: unknown, request: Request) {
  const batch = createPostHogBatch({
    lib: "teak-web-server",
    libVersion: packageJson.version,
    platform: "workers:javascript",
    // Inlined at build time, not a hard-coded token.
    // nosemgrep: codacy.yaml.security.hard-coded-tokens
    token: import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN,
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
