/**
 * Signs the Debug app ("Teak Dev") in to the local E2E stack as a fresh emulator account:
 *   bun --no-env-file run apps/android/scripts/e2e-session.ts
 * Set ANDROID_SERIAL to pick a device. It reverses the stack's ports so localhost works on the
 * device, writes files/e2e/launch.json through `adb shell run-as` (debuggable builds only), and
 * restarts the app. Prints the account's email and WorkOS user id for seeding.
 */
import { spawnSync } from "node:child_process";
import { EMULATOR_CLIENT_ID } from "../../../scripts/dev/local-stack/config.ts";
import {
  createSession,
  type E2eSession,
  loopbackUrl,
} from "../../../scripts/lib/e2e-session.ts";

export const DEBUG_PACKAGE = "com.praveenjuge.teak.debug";
const LAUNCH_PATH = "files/e2e/launch.json";

/** The ports the app reaches: Convex, its HTTP site, the WorkOS emulator and the Core Worker. */
export const reversePorts = (ports: Record<string, unknown>): number[] =>
  ["convex", "convexSite", "emulator", "coreWorker", "web"]
    .map((key) => ports[key])
    .filter((port): port is number => typeof port === "number");

export const launchFile = (session: E2eSession) => {
  for (const url of [session.urls.convexUrl, session.urls.emulatorOrigin]) {
    loopbackUrl("/", url);
  }
  return {
    convexUrl: session.urls.convexUrl,
    workosUrl: session.urls.emulatorOrigin,
    clientId: EMULATOR_CLIENT_ID,
    session: Buffer.from(JSON.stringify(session.response)).toString("base64"),
  };
};

const adb = (args: string[], input?: string) => {
  const result = spawnSync("adb", args, { input, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`adb ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
};

if (import.meta.main) {
  const session = await createSession("android");
  for (const port of reversePorts({ ...session.stack.ports })) {
    adb(["reverse", `tcp:${port}`, `tcp:${port}`]);
  }
  adb(["shell", "am", "force-stop", DEBUG_PACKAGE]);
  adb(
    [
      "shell",
      "run-as",
      DEBUG_PACKAGE,
      "sh",
      "-c",
      `'mkdir -p files/e2e && cat > ${LAUNCH_PATH}'`,
    ],
    JSON.stringify(launchFile(session))
  );
  adb(["shell", "monkey", "-p", DEBUG_PACKAGE, "1"]);
  console.log(
    JSON.stringify({
      email: session.email,
      workosUserId: session.response.user.id,
    })
  );
}
