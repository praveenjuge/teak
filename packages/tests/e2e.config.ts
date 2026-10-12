import { web } from "@e2e-dev/web";
import {
  cloudChromiumConnect,
  cloudChromiumPath,
} from "./src/config/cloud-chromium.ts";
import { suiteConfig } from "./src/config/suite.ts";
import { stackAppUrl, stackMode } from "./src/helpers/env.ts";

// In a cloud session, `e2e mcp` against the dev stack drives the image's
// Chromium: the session's proxy breaks the pinned one's Convex socket (see
// src/config/cloud-chromium.ts). The suite itself always runs the E2E stack.
const cloudChromium = stackMode() === "dev" ? cloudChromiumPath() : undefined;
const engine = cloudChromium
  ? web({ connect: cloudChromiumConnect(cloudChromium) })
  : web();

// The main suite: journeys, web surfaces, the API, CLI and MCP, and the
// Chromium half of the browser matrix, against this checkout's local stack
// (src/scripts/run-local-suite.ts starts it). The WebKit half runs from
// e2e.webkit.config.ts, the published site from e2e.docs.config.ts, and the
// hermetic OAuth checks from e2e.hermetic.config.ts.
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
