import { web } from "@e2e-dev/web";
import { suiteConfig } from "./src/config/suite.ts";
import { published } from "./src/helpers/env.ts";

// Read-only checks of the published site and Teak's public production
// endpoints. They need no local stack.
export default suiteConfig("docs", {
  targets: [
    { name: "chromium", engine: web(), app: { url: published.siteUrl } },
  ],
  tests: ["src/docs/**/*.e2e.ts"],
  retries: 1,
  workers: 4,
});
