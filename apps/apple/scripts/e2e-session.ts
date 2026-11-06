/**
 * Prints the launch environment that signs the app in to this checkout's
 * running E2E stack as a fresh emulator account:
 *   bun --no-env-file run apps/apple/scripts/e2e-session.ts
 * With `--runner-env`, prints the stack's URLs as shell exports for
 * apps/apple/scripts/ui-tests.sh instead.
 */

import { EMULATOR_CLIENT_ID } from "../../../packages/tests/src/stack/config.ts";
import {
  createSession,
  type E2eSession,
  loadE2eStack,
} from "../../../scripts/lib/e2e-session.ts";

export { loopbackUrl } from "../../../scripts/lib/e2e-session.ts";

export const launchEnvironment = (session: E2eSession) => ({
  TeakConvexURL: session.urls.convexUrl,
  TeakWorkOSURL: session.urls.emulatorOrigin,
  TeakWebURL: session.urls.appOrigin,
  TeakEnvironment: "e2e",
  TEAK_UI_TEST_CLIENT_ID: EMULATOR_CLIENT_ID,
  TEAK_UI_TEST_SESSION: Buffer.from(JSON.stringify(session.response)).toString(
    "base64"
  ),
});

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** The XCUITest runner's environment: the stack's URLs, as shell exports. */
export const runnerExports = (urls: {
  appOrigin: string;
  convexUrl: string;
  emulatorOrigin?: string;
}): string =>
  [
    ["TEST_RUNNER_TEAK_E2E_CONVEX_URL", urls.convexUrl],
    ["TEST_RUNNER_TEAK_E2E_EMULATOR_URL", urls.emulatorOrigin ?? ""],
    ["TEST_RUNNER_TEAK_E2E_WEB_URL", urls.appOrigin],
  ]
    .map(([name, value]) => `export ${name}=${shellQuote(value)}`)
    .join("\n");

if (import.meta.main) {
  if (process.argv.includes("--runner-env")) {
    try {
      console.log(runnerExports(loadE2eStack().urls));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  } else {
    const session = await createSession("apple");
    for (const [key, value] of Object.entries(launchEnvironment(session))) {
      console.log(`${key}=${value}`);
    }
  }
}
