import betterAuth from "@convex-dev/better-auth/convex.config";
import polar from "@convex-dev/polar/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import resend from "@convex-dev/resend/convex.config";
import workflow from "@convex-dev/workflow/convex.config";
import workOSAuthKit from "@convex-dev/workos-authkit/convex.config";
import apiKeys from "@vllnt/convex-api-keys/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    // Core.
    PUBLIC_ORIGIN: v.optional(v.string()),
    SIGNUPS_DISABLED: v.optional(v.string()),
    ACCOUNT_CHANGES_PAUSED: v.optional(v.string()),
    // WorkOS AuthKit: the only sign-in provider.
    WORKOS_API_BASE_URL: v.optional(v.string()),
    WORKOS_AUTHKIT_DOMAIN: v.optional(v.string()),
    WORKOS_CONNECT_CLI_CLIENT_ID: v.optional(v.string()),
    WORKOS_CONNECT_RAYCAST_CLIENT_ID: v.optional(v.string()),
    WORKOS_CONNECT_CHROME_CLIENT_ID: v.optional(v.string()),
    WORKOS_CONNECT_FIREFOX_CLIENT_ID: v.optional(v.string()),
    WORKOS_CONNECT_SAFARI_CLIENT_ID: v.optional(v.string()),
    WORKOS_ENVIRONMENT_ID: v.optional(v.string()),
    WORKOS_WEBHOOK_SECRET: v.optional(v.string()),
    WORKOS_ACTION_SECRET: v.optional(v.string()),
    // Files / R2 capability group.
    FILES_BASE: v.optional(v.string()),
    FILES_SIGNING_SECRET: v.optional(v.string()),
    R2_BUCKET: v.optional(v.string()),
    R2_ENDPOINT: v.optional(v.string()),
    R2_ACCESS_KEY_ID: v.optional(v.string()),
    R2_SECRET_ACCESS_KEY: v.optional(v.string()),
    R2_KEY_PREFIX: v.optional(v.string()),
    // Cloudflare AI capability group.
    CLOUDFLARE_ACCOUNT_ID: v.optional(v.string()),
    CLOUDFLARE_API_TOKEN: v.optional(v.string()),
    // Polar billing capability group.
    POLAR_ACCESS_TOKEN: v.optional(v.string()),
    POLAR_SERVER: v.optional(v.string()),
    // Sentry capability group.
    SENTRY_ENVIRONMENT: v.optional(v.string()),
    SENTRY_RELEASE: v.optional(v.string()),
    SENTRY_BACKEND_DSN: v.optional(v.string()),
    SENTRY_DSN: v.optional(v.string()),
    CONVEX_GIT_COMMIT_SHA: v.optional(v.string()),
    // Administration.
    // Staged operational-cost rollout; unset means disabled.
    OPERATIONAL_RETENTION_ENABLED: v.optional(v.string()),
    FILES_TEXT_AI_ENABLED: v.optional(v.string()),
    // The shared cloud dev deployment: "true" enables dev tooling (seed data,
    // the backend push lease). Never set in production.
    TEAK_DEV_DEPLOYMENT: v.optional(v.string()),
    // Local dev-URL overrides.
    TEAK_DEV_APP_URL: v.optional(v.string()),
    TEAK_DEV_API_URL: v.optional(v.string()),
    TEAK_DEV_DOCS_URL: v.optional(v.string()),
  },
});
app.use(betterAuth);
app.use(workOSAuthKit);
app.use(polar);
app.use(workflow);
app.use(resend);
app.use(rateLimiter, { name: "rateLimiterV2" });
app.use(apiKeys);

export default app;
