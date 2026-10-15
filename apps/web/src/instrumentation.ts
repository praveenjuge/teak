import { createPostHogBatch } from "@teak/convex/shared/posthog";
import type { Instrumentation } from "next";
import packageJson from "../package.json";
import { resolvePostHogToken } from "./lib/posthog-config";

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  const batch = createPostHogBatch({
    lib: "teak-web-server",
    libVersion: packageJson.version,
    platform: "node:javascript",
    token: resolvePostHogToken({
      token: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
      vercelEnvironment: process.env.VERCEL_ENV,
    }),
  });
  if (!batch.enabled) {
    return;
  }
  batch.captureException(error, {
    handled: false,
    properties: {
      $app_version: packageJson.version,
      digest:
        error && typeof error === "object" && "digest" in error
          ? String(error.digest)
          : undefined,
      method: request.method,
      route: context.routePath,
      route_type: context.routeType,
      surface: "web",
    },
  });
  await batch.flush();
};
