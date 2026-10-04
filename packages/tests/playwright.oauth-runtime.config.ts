import { defineConfig, devices } from "@playwright/test";

// Controlled browser-runtime proof. No production accounts or environment files.
export default defineConfig({
  testDir: "./src/extension",
  testMatch: "oauth-runtime.e2e.ts",
  timeout: 30_000,
  workers: 2,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/oauth-runtime/report.json" }],
  ],
  outputDir: "test-results/oauth-runtime",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "oauth-chrome-runtime", use: devices["Desktop Chrome"] },
    { name: "oauth-firefox-runtime", use: devices["Desktop Firefox"] },
  ],
});
