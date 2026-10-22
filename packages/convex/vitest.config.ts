import { defineConfig } from "vitest/config";

const cloudflareModules = new URL(
  "./__tests__/helpers/cloudflareModules.test-utils.ts",
  import.meta.url
).pathname;

export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": cloudflareModules,
      "cloudflare:workflows": cloudflareModules,
    },
  },
  test: {
    environment: "edge-runtime",
    env: {
      CONVEX_SITE_URL: "https://session-tests.convex.site",
      WORKOS_CLIENT_ID: "client_edgetests",
      WORKOS_WEBHOOK_SECRET: "edge-test-webhook-secret",
    },
    include: ["./edge/**/*.test.ts"],
  },
});
