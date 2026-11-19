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
    },
    include: ["./edge/**/*.test.ts"],
    // Many of these tests write hundreds of rows through convex-test and take
    // 1 to 3 seconds on an idle machine, so the 5 second default failed them
    // whenever other packages' tests shared the CPU.
    testTimeout: 20_000,
  },
});
