import { defineConfig, devices } from "@playwright/test";

const DEFAULT_PORT = process.env.PORT || "3000";
const shouldStartServer = !process.env.PLAYWRIGHT_SKIP_WEBSERVER;

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL:
      process.env.PLAYWRIGHT_BASE_URL ||
      `http://127.0.0.1:${DEFAULT_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  globalSetup: "./tests/global.setup.ts",
  webServer: shouldStartServer
    ? {
      command: "bun run dev",
      cwd: ".",
      port: Number(DEFAULT_PORT),
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        PORT: DEFAULT_PORT,
      },
    }
    : undefined,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
