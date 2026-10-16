import { web } from "@e2e-dev/web";
import { suiteConfig } from "./src/config/suite.ts";
import { published } from "./src/helpers/env.ts";

export default suiteConfig("docs", {
  targets: [
    { name: "chromium", engine: web(), app: { url: published.siteUrl } },
  ],
  tests: ["src/docs/**/*.e2e.ts"],
  retries: 1,
  workers: 4,
});
