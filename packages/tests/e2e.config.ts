import { web } from "@e2e-dev/web";
import {
  cloudChromiumConnect,
  cloudChromiumPath,
} from "./src/config/cloud-chromium.ts";
import { suiteConfig } from "./src/config/suite.ts";
import { stackAppUrl, stackMode } from "./src/helpers/env.ts";

const cloudChromium = stackMode() === "dev" ? cloudChromiumPath() : undefined;
const engine = cloudChromium
  ? web({ connect: cloudChromiumConnect(cloudChromium) })
  : web();

export default suiteConfig("chromium", {
  targets: [{ name: "chromium", engine, app: { url: stackAppUrl() } }],
  tests: [
    "src/journey/**/*.e2e.ts",
    "src/web/**/*.e2e.ts",
    "src/matrix/**/*.e2e.ts",
  ],
  retries: 0,
  // GitHub's standard runner shares 4 cores between the browser, the backend
  // and the dev server. A second browser starves the backend, whose functions
  // then hit Convex's 1 s limit; pass --workers to try more on a bigger machine.
  workers: 1,
});
