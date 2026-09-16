import { defineConfig, devices } from "@playwright/test";
import { resolveTeakDevAppUrl } from "@teak/convex/dev-urls";
import dotenv from "dotenv";

// Explicit test-only scope first (wins on conflicts), then build inputs for
// backward compatibility. Keep E2E credentials in .env.e2e.local; the
// dotenv audit flags them in .env.local as wrong-scope.
dotenv.config({ path: ".env.e2e.local" });
dotenv.config({ path: ".env.local" });

const DEFAULT_BASE_URL = resolveTeakDevAppUrl(process.env);
const shouldStartServer = !process.env.PLAYWRIGHT_SKIP_WEBSERVER;

export default defineConfig({
  testDir: "./src/tests",
  testMatch: "**/*.e2e.ts",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || DEFAULT_BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  globalSetup: "./src/tests/global.setup.ts",
  webServer: shouldStartServer
    ? {
        command: "bun run dev",
        cwd: "../..",
        url: process.env.PLAYWRIGHT_BASE_URL || DEFAULT_BASE_URL,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
      }
    : undefined,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
