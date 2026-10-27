import betterAuth from "@convex-dev/better-auth/convex.config";
import polar from "@convex-dev/polar/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import workOSAuthKit from "@convex-dev/workos-authkit/convex.config";
import apiKeys from "@vllnt/convex-api-keys/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    PUBLIC_ORIGIN: v.optional(v.string()),
    WORKOS_API_BASE_URL: v.optional(v.string()),
    WORKOS_AUTHKIT_DOMAIN: v.optional(v.string()),
    WORKOS_RESOURCE_ORIGIN: v.optional(v.string()),
    WORKOS_CONNECT_CLI_CLIENT_ID: v.optional(v.string()),
    WORKOS_CONNECT_RAYCAST_CLIENT_ID: v.optional(v.string()),
    WORKOS_CONNECT_CHROME_CLIENT_ID: v.optional(v.string()),
    WORKOS_CONNECT_FIREFOX_CLIENT_ID: v.optional(v.string()),
    WORKOS_ENVIRONMENT_ID: v.optional(v.string()),
    WORKOS_WEBHOOK_SECRET: v.optional(v.string()),
    WORKOS_ACTION_SECRET: v.optional(v.string()),
    FILES_BASE: v.optional(v.string()),
    FILES_SIGNING_SECRET: v.optional(v.string()),
    WORKFLOW_RPC_SECRET: v.optional(v.string()),
    // Save by email (inbound/): the Email Worker signs what it posts with this.
    EMAIL_INBOUND_SIGNING_SECRET: v.optional(v.string()),
    // The domain of the shared save@ address; in.teakvault.com when unset.
    INBOUND_EMAIL_DOMAIN: v.optional(v.string()),
    R2_KEY_PREFIX: v.optional(v.string()),
    POLAR_ACCESS_TOKEN: v.optional(v.string()),
    POLAR_SERVER: v.optional(v.string()),
    // nosemgrep: codacy.yaml.security.hard-coded-tokens
    POSTHOG_PROJECT_TOKEN: v.optional(v.string()),
    POSTHOG_QUERY_API_KEY: v.optional(v.string()),
    POSTHOG_PERSON_DELETION_API_KEY: v.optional(v.string()),
    CONVEX_GIT_COMMIT_SHA: v.optional(v.string()),
    TEAK_DEV_DEPLOYMENT: v.optional(v.string()),
    TEAK_DEV_APP_URL: v.optional(v.string()),
    TEAK_DEV_API_URL: v.optional(v.string()),
    TEAK_DEV_DOCS_URL: v.optional(v.string()),
  },
});
app.use(betterAuth);
app.use(workOSAuthKit);
app.use(polar);
app.use(rateLimiter, { name: "rateLimiterV2" });
app.use(apiKeys);

export default app;
