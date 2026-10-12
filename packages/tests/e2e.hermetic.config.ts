import { web } from "@e2e-dev/web";
import { suiteConfig } from "./src/config/suite.ts";
import { FIXTURE_URLS } from "./src/helpers/env.ts";

// Every request in these specs is routed to a fixture, so they need no stack
// (src/helpers/env.ts). e2e imports this config again in every worker, so the
// workers see it too.
process.env.TEAK_E2E_HERMETIC = "1";

// The hermetic auth checks: the WorkOS consent journey and the Security dialog
// helpers against fixture pages, and the extension's OAuth module compiled
// and run in a real browser. No accounts, environment files, or local stack.
export default suiteConfig("hermetic", {
  targets: [
    {
      name: "chromium",
      engine: web(),
      app: { url: FIXTURE_URLS.appOrigin },
    },
  ],
  tests: ["src/auth-runtime/**/*.e2e.ts", "src/extension/**/*.e2e.ts"],
  timeout: 30_000,
  retries: 0,
  // The consent specs replace their worker's global fetch while they run.
  // Each worker has its own globals, and a file's tests run in order on one
  // worker, so two workers never see each other's fetch.
  workers: 2,
  trace: "on",
});
