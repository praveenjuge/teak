import { web } from "@e2e-dev/web";
import { suiteConfig } from "./src/config/suite.ts";
import { stackAppUrl } from "./src/helpers/env.ts";

export default suiteConfig("warmup", {
  targets: [{ name: "chromium", engine: web(), app: { url: stackAppUrl() } }],
  tests: ["src/warmup/**/*.e2e.ts"],
  // Warming is the point: a cold route can outlast the first attempt while
  // Next.js compiles it, and the retry finds it compiled.
  retries: 1,
  workers: 1,
});
