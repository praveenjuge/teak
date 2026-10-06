import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./src/auth-runtime",
  testMatch: "*.e2e.ts",
  timeout: 30_000,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/auth-runtime/report.json" }],
  ],
  outputDir: "test-results/auth-runtime",
  use: { ...devices["Desktop Chrome"], trace: "on", screenshot: "on" },
});
