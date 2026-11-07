import { web } from "@e2e-dev/web";
import { suiteConfig } from "./src/config/suite.ts";
import { published } from "./src/helpers/env.ts";

export default suiteConfig("docs", {
  targets: [
    { name: "chromium", engine: web(), app: { url: published.siteUrl } },
  ],
  tests: ["src/docs/**/*.e2e.ts"],
  // These read the live site and production endpoints over the internet, so
  // one retry absorbs a network blip that no change here can fix.
  retries: 1,
  workers: 4,
});
