import betterAuth from "@convex-dev/better-auth/convex.config";
import polar from "@convex-dev/polar/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import resend from "@convex-dev/resend/convex.config";
import workflow from "@convex-dev/workflow/convex.config";
import apiKeys from "@vllnt/convex-api-keys/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    // Core. SITE_URL is the only required backend variable; setup always
    // configures it locally before the first push.
    SITE_URL: v.string(),
    PUBLIC_ORIGIN: v.optional(v.string()),
    JWKS: v.optional(v.string()),
    // Google capability group. Optional as a whole; ID and secret are
    // required atomically (see ./env.ts).
    GOOGLE_CLIENT_ID: v.optional(v.string()),
    GOOGLE_CLIENT_SECRET: v.optional(v.string()),
    // Apple capability group. Optional as a whole; validated at use time.
    APPLE_CLIENT_ID: v.optional(v.string()),
    APPLE_KEY_ID: v.optional(v.string()),
    APPLE_PRIVATE_KEY: v.optional(v.string()),
    APPLE_TEAM_ID: v.optional(v.string()),
    APPLE_APP_BUNDLE_IDENTIFIER: v.optional(v.string()),
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
    TEAK_ADMIN_EMAIL: v.optional(v.string()),
    // E2E capability group.
    E2E_CLEANUP_TOKEN: v.optional(v.string()),
    E2E_EMAIL_DOMAIN: v.optional(v.string()),
    // Local dev-URL overrides.
    TEAK_DEV_APP_URL: v.optional(v.string()),
    TEAK_DEV_API_URL: v.optional(v.string()),
    TEAK_DEV_DOCS_URL: v.optional(v.string()),
  },
});
app.use(betterAuth);
app.use(polar);
app.use(workflow);
app.use(resend);
app.use(rateLimiter, { name: "rateLimiterV2" });
app.use(apiKeys);

export default app;
