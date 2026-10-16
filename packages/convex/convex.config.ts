import betterAuth from "@convex-dev/better-auth/convex.config";
import polar from "@convex-dev/polar/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import workflow from "@convex-dev/workflow/convex.config";
import workOSAuthKit from "@convex-dev/workos-authkit/convex.config";
import apiKeys from "@vllnt/convex-api-keys/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    PUBLIC_ORIGIN: v.optional(v.string()),
    SIGNUPS_DISABLED: v.optional(v.string()),
    ACCOUNT_CHANGES_PAUSED: v.optional(v.string()),
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
    R2_BUCKET: v.optional(v.string()),
    R2_KEY_PREFIX: v.optional(v.string()),
    POLAR_ACCESS_TOKEN: v.optional(v.string()),
    POLAR_SERVER: v.optional(v.string()),
    // PostHog product analytics and error reports; set in production only.
    // A validator for the env var name, not a token value.
    // nosemgrep: codacy.yaml.security.hard-coded-tokens
    POSTHOG_PROJECT_TOKEN: v.optional(v.string()),
    POSTHOG_QUERY_API_KEY: v.optional(v.string()),
    // Personal API key (person:write) that deletes a deleted owner's PostHog
    // person, events and recordings. Required wherever POSTHOG_PROJECT_TOKEN
    // is set, or account deletion retries until it is.
    POSTHOG_PERSON_DELETION_API_KEY: v.optional(v.string()),
    CONVEX_GIT_COMMIT_SHA: v.optional(v.string()),
    ADMIN_ALERT_WEBHOOK_URL: v.optional(v.string()),
    OPERATIONAL_RETENTION_ENABLED: v.optional(v.string()),
    TEAK_DEV_DEPLOYMENT: v.optional(v.string()),
    TEAK_DEV_APP_URL: v.optional(v.string()),
    TEAK_DEV_API_URL: v.optional(v.string()),
    TEAK_DEV_DOCS_URL: v.optional(v.string()),
  },
});
app.use(betterAuth);
app.use(workOSAuthKit);
app.use(polar);
app.use(workflow);
app.use(rateLimiter, { name: "rateLimiterV2" });
app.use(apiKeys);

export default app;
