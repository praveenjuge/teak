import { defineConfig, devices } from "@playwright/test";
import { env } from "./src/helpers/env";

const deleteAccount = "journey/99-delete-account.e2e.ts";
const postDelete = "journey/100-post-delete.e2e.ts";
const importExportTest = /settings import and export surface terminal states/;

export default defineConfig({
  testDir: "./src",
  timeout: 120_000,
  workers: 4,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: env.appUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "journey-setup",
      testMatch: "journey/01-signup.setup.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "journey-web-core",
      dependencies: ["journey-setup"],
      testMatch: "journey/02-web-journey.e2e.ts",
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".state/web-core.json",
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
      },
    },
    {
      name: "journey-web-surfaces",
      dependencies: ["journey-setup"],
      testMatch: "journey/09-web-product-surfaces.e2e.ts",
      grepInvert: importExportTest,
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".state/web-surfaces.json",
      },
    },
    {
      name: "journey-web-files",
      dependencies: ["journey-setup"],
      testMatch: "journey/10-file-format-ui.e2e.ts",
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".state/web-files.json",
      },
    },
    {
      name: "journey-web-filters",
      dependencies: ["journey-setup"],
      testMatch: "journey/11-quote-favorites-filters.e2e.ts",
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".state/web-filters.json",
      },
    },
    {
      name: "journey-import-export",
      dependencies: ["journey-setup"],
      grep: importExportTest,
      testMatch: "journey/09-web-product-surfaces.e2e.ts",
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".state/import-export.json",
      },
    },
    ...(
      [
        ["api", ["journey/03-api.e2e.ts", "journey/12-file-roundtrip.e2e.ts"]],
        ["cli", "journey/04-cli.e2e.ts"],
        ["mcp", "journey/05-mcp.e2e.ts"],
      ] satisfies [string, string | string[]][]
    ).map(([surface, testMatch]) => ({
      name: `journey-${surface}`,
      dependencies: ["journey-setup"],
      testMatch,
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".state/user.json",
      },
    })),
    {
      name: "journey-a11y",
      dependencies: ["journey-setup"],
      fullyParallel: true,
      testMatch: "journey/08-a11y.e2e.ts",
      workers: 4,
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".state/user.json",
      },
    },
    {
      name: "journey-security",
      dependencies: ["journey-setup", "journey-web-core"],
      testMatch: "journey/06-security.e2e.ts",
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".state/user.json",
      },
    },
    {
      name: "journey-account",
      dependencies: ["journey-setup"],
      testMatch: "journey/07-account-flows.e2e.ts",
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".state/account.json",
      },
    },
    {
      name: "journey-delete",
      dependencies: ["journey-account"],
      testMatch: deleteAccount,
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".state/account.json",
      },
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
      fullyParallel: true,
      testMatch: "docs/**/*.e2e.ts",
      retries: 1,
      workers: 4,
      use: { ...devices["Desktop Chrome"], baseURL: env.siteUrl },
    },
    {
      name: "matrix-chromium",
      fullyParallel: true,
      testMatch: "matrix/journey-lite.e2e.ts",
      workers: 1,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "matrix-firefox",
      fullyParallel: true,
      testMatch: "matrix/journey-lite.e2e.ts",
      workers: 1,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "matrix-webkit",
      fullyParallel: true,
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
