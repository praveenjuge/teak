import { defineConfig, devices } from "@playwright/test";
import { readStackState } from "../../scripts/lib/stack-state.ts";
import { published } from "./src/helpers/env";
import type { AccountKey } from "./src/helpers/run-state";
import type { JourneyOptions } from "./src/helpers/test";

// Runs against this checkout's local stack, started by
// src/scripts/run-local-suite.ts. The docs project needs none.
const chrome = devices["Desktop Chrome"];
const journey = (
  name: string,
  testMatch: string | string[],
  account?: AccountKey,
  dependencies = ["journey-setup"]
) => ({
  name: `journey-${name}`,
  dependencies,
  testMatch,
  workers: 1,
  use: { ...chrome, account },
});

export default defineConfig<JourneyOptions>({
  testDir: "./src",
  timeout: 120_000,
  // GitHub's standard runner shares 4 cores between the browsers, the
  // backend and the dev server; more browsers than this starve the backend.
  workers: process.env.CI ? 2 : 4,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    // The docs project runs without a stack and sets its own baseURL.
    baseURL: readStackState()?.urls.appOrigin,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      // Everything that uses the stack starts after this warms it.
      name: "warmup",
      testMatch: "warmup.setup.ts",
      use: chrome,
    },
    {
      name: "journey-setup",
      dependencies: ["warmup"],
      testMatch: "journey/01-signup.setup.ts",
      use: chrome,
    },
    journey("web-core", "journey/02-web-journey.e2e.ts", "webCore"),
    journey(
      "web-surfaces",
      "journey/09-web-product-surfaces.e2e.ts",
      "webSurfaces"
    ),
    journey(
      "web-filters",
      "journey/11-quote-favorites-filters.e2e.ts",
      "webFilters"
    ),
    journey("api", [
      "journey/03-api.e2e.ts",
      "journey/13-occ-concurrency.e2e.ts",
    ]),
    journey("cli", "journey/04-cli.e2e.ts"),
    journey("mcp", "journey/05-mcp.e2e.ts"),
    journey("a11y", "journey/08-a11y.e2e.ts", "primary"),
    journey("security", "journey/06-security.e2e.ts", "security", [
      "journey-setup",
      "journey-web-core",
    ]),
    journey("account", "journey/07-account-flows.e2e.ts"),
    journey("delete", "journey/99-delete-account.e2e.ts", undefined, [
      "journey-account",
    ]),
    journey("post-delete", "journey/100-post-delete.e2e.ts", undefined, [
      "journey-delete",
    ]),
    {
      // Web surface specs; each worker signs up its own account.
      name: "web",
      dependencies: ["warmup"],
      testMatch: "web/**/*.e2e.ts",
      workers: 2,
      use: chrome,
    },
    ...(["chromium", "firefox", "webkit"] as const).map((browser) => ({
      name: `matrix-${browser}`,
      dependencies: ["warmup"],
      testMatch: "matrix/journey-lite.e2e.ts",
      workers: 1,
      use: devices[
        {
          chromium: "Desktop Chrome",
          firefox: "Desktop Firefox",
          webkit: "Desktop Safari",
        }[browser]
      ],
    })),
    {
      // Read-only checks of the published site; no stack needed.
      name: "docs",
      fullyParallel: true,
      testMatch: "docs/**/*.e2e.ts",
      retries: 1,
      workers: 4,
      use: { ...chrome, baseURL: published.siteUrl },
    },
  ],
  outputDir: "test-results",
});
