import { web } from "@e2e-dev/web";
import { suiteConfig } from "./src/config/suite.ts";
import { stackAppUrl } from "./src/helpers/env.ts";

export default suiteConfig("webkit", {
  targets: [
    {
      name: "webkit",
      engine: web({ browser: "webkit" }),
      app: { url: stackAppUrl() },
    },
  ],
  tests: ["src/matrix/**/*.e2e.ts"],
  retries: 0,
  workers: 1,
});
