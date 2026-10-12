import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebConnectOptions } from "@e2e-dev/web";

/**
 * Cloud sessions reach the shared dev deployment through an intercepting
 * HTTPS proxy that can't carry WebSocket upgrades. The image's Chromium
 * (`TEAK_CLOUD_CHROMIUM`) is passed through to Convex untouched, but the
 * proxy intercepts e2e's pinned Chromium and Convex refuses its sync socket
 * (`400 InvalidConnectionHeader`). So against the dev stack in a cloud
 * session, e2e attaches to the image's Chromium over CDP instead of
 * launching its own. The E2E stack is all on localhost and never needs this.
 */

let running: Promise<string> | undefined;

// Runs Chromium under a small Node process that kills it once its stdin, a
// pipe from this process, closes: when the MCP server or test worker exits by
// any means, signals included, its browser goes with it. Chromium's stderr,
// which announces the DevTools endpoint, passes through.
const WATCHDOG = `
const [executable, ...args] = process.argv.slice(1);
const browser = require("node:child_process").spawn(executable, args, {
  stdio: ["ignore", "ignore", "inherit"],
});
process.stdin.on("end", () => browser.kill()).resume();
browser.on("exit", (code) => process.exit(code ?? 1));
`;

const launch = (executablePath: string, signal: AbortSignal) =>
  new Promise<string>((resolve, reject) => {
    const profile = mkdtempSync(join(tmpdir(), "teak-cloud-chromium-"));
    const browser = spawn(
      process.execPath,
      [
        "--eval",
        WATCHDOG,
        executablePath,
        "--headless=new",
        // As Playwright launches it: cloud sessions run as root.
        "--no-sandbox",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      { stdio: ["pipe", "ignore", "pipe"] }
    );
    let output = "";
    const fail = (error: Error) => {
      browser.stdin?.end();
      reject(error);
    };
    // Only a launch still starting is abandoned; a browser that came up
    // stays for the rest of the process.
    const abandon = () => fail(new Error("Chromium launch aborted"));
    signal.addEventListener("abort", abandon, { once: true });
    browser.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const endpoint = output.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];
      if (endpoint) {
        signal.removeEventListener("abort", abandon);
        resolve(endpoint);
      }
    });
    browser.once("error", fail);
    browser.once("exit", (code) => {
      running = undefined;
      rmSync(profile, { force: true, recursive: true });
      reject(new Error(`${executablePath} exited with ${code}:\n${output}`));
    });
  });

const IMAGE_BROWSERS = "/opt/pw-browsers";

/**
 * The image's Chromium in a cloud session. The SessionStart hook exports it as
 * `TEAK_CLOUD_CHROMIUM`, but only to shell commands; MCP servers start
 * without the hook's exports, so look in the image as the hook does.
 */
export const cloudChromiumPath = (): string | undefined => {
  if (process.env.TEAK_CLOUD_CHROMIUM) {
    return process.env.TEAK_CLOUD_CHROMIUM;
  }
  if (
    process.env.CLAUDE_CODE_REMOTE !== "true" ||
    !existsSync(IMAGE_BROWSERS)
  ) {
    return;
  }
  return readdirSync(IMAGE_BROWSERS)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(a.slice(9)) - Number(b.slice(9)))
    .map((name) => join(IMAGE_BROWSERS, name, "chrome-linux", "chrome"))
    .filter((path) => existsSync(path))
    .at(-1);
};

/** The engine's `connect` option, launching the image's Chromium once. */
export const cloudChromiumConnect = (
  executablePath: string
): WebConnectOptions => ({
  cdpEndpoint: (signal) => {
    running ??= launch(executablePath, signal);
    return running;
  },
});
