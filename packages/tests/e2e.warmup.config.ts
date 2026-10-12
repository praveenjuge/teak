import { web } from "@e2e-dev/web";
import { suiteConfig } from "./src/config/suite.ts";
import { stackAppUrl } from "./src/helpers/env.ts";

// Runs alone before the suites (src/scripts/run-local-suite.ts): compiles the
// signed-in routes and loads the backend modules once.
export default suiteConfig("warmup", {
  targets: [{ name: "chromium", engine: web(), app: { url: stackAppUrl() } }],
  tests: ["src/warmup/**/*.e2e.ts"],
  retries: 1,
  workers: 1,
});
