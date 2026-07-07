import { defineConfig, devices } from "@playwright/test";
import { env } from "./src/helpers/env";

const journey = "src/journey/**/*.e2e.ts";
const deleteAccount = "journey/99-delete-account.e2e.ts";
const postDelete = "journey/100-post-delete.e2e.ts";

export default defineConfig({
  testDir: "./src",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: env.appUrl,
    trace: "retain-on-failure",
    screenshot: "on",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "journey-setup",
      testMatch: "journey/01-signup.setup.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "journey",
      dependencies: ["journey-setup"],
      testIgnore: ["journey/01-signup.setup.ts", deleteAccount, postDelete],
      testMatch: journey,
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".state/user.json",
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
      },
    },
    {
      name: "journey-delete",
      dependencies: ["journey"],
      testMatch: deleteAccount,
      workers: 1,
      use: { ...devices["Desktop Chrome"], storageState: ".state/user.json" },
    },
    {
      name: "journey-post-delete",
      dependencies: ["journey-delete"],
      testMatch: postDelete,
      workers: 1,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "docs",
      testMatch: "docs/**/*.e2e.ts",
      retries: 1,
      use: { ...devices["Desktop Chrome"], baseURL: env.siteUrl },
    },
    {
      name: "matrix-chromium",
      testMatch: "matrix/journey-lite.e2e.ts",
      workers: 1,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "matrix-firefox",
      testMatch: "matrix/journey-lite.e2e.ts",
      workers: 1,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "matrix-webkit",
      testMatch: "matrix/journey-lite.e2e.ts",
      workers: 1,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "extension",
      testMatch: "extension/save-page.e2e.ts",
      workers: 1,
      use: { ...devices["Desktop Chrome"], channel: "chromium" },
    },
  ],
  outputDir: "test-results",
});
