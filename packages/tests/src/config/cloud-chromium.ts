import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebConnectOptions } from "@e2e-dev/web";

/**
 * In a cloud session, against the dev stack, e2e attaches over CDP to a
 * Chromium this module starts instead of launching its own, so agents can
 * attach to the same browser too: the "Upload files" button and the Settings
 * import create or hide their file inputs where e2e's `upload` tool can't
 * reach them, and a script drives the file chooser through this browser's
 * DevTools port (`DevToolsActivePort` in its `/tmp/teak-cloud-chromium-`
 * profile, `development.mdx`, "Cloud sessions in detail"). It runs the image's Chromium, which is always there:
 * MCP servers start before the SessionStart hook, so e2e's own browsers may
 * not be linked in yet. Until October 2026 this was also the only browser
 * whose Convex socket got through the session's HTTPS proxy; that no longer
 * holds, and any Chromium now loads the app. The E2E stack is all on
 * localhost and never needs this.
 */

let running: Promise<string> | undefined;

const KILL_CHROMIUM_ON_STDIN_EOF = `
const [executable, ...args] = process.argv.slice(1);
const browser = require("node:child_process").spawn(executable, args, {
  stdio: ["ignore", "ignore", "inherit"],
});
process.stdin.on("end", () => browser.kill()).resume();
browser.on("exit", (code) => process.exit(code ?? 1));
`;

const launch = (executablePath: string, signal: AbortSignal) => {
  const launching: Promise<string> = new Promise((resolve, reject) => {
    const profile = mkdtempSync(join(tmpdir(), "teak-cloud-chromium-"));
    const browser = spawn(
      process.execPath,
      [
        "--eval",
        KILL_CHROMIUM_ON_STDIN_EOF,
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
    const abandon = () => fail(new Error("Chromium launch aborted"));
    const forget = () => {
      signal.removeEventListener("abort", abandon);
      if (running === launching) {
        running = undefined;
      }
    };
    const fail = (error: Error) => {
      forget();
      browser.stdin?.end();
      reject(error);
    };
    signal.addEventListener("abort", abandon, { once: true });
    browser.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const endpoint = output.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];
      if (endpoint) {
        signal.removeEventListener("abort", abandon);
        resolve(endpoint);
      }
    });
    // A watchdog that never started may emit no exit.
    browser.once("error", (error) => {
      fail(error);
      rmSync(profile, { force: true, recursive: true });
    });
    browser.once("exit", (code) => {
      forget();
      rmSync(profile, { force: true, recursive: true });
      reject(new Error(`${executablePath} exited with ${code}:\n${output}`));
    });
  });
  return launching;
};

const IMAGE_BROWSERS = "/opt/pw-browsers";

/** The newest Chromium in the image of a Claude Code cloud session. */
export const cloudChromiumPath = (): string | undefined => {
  if (
    process.env.CLAUDE_CODE_REMOTE !== "true" ||
    !existsSync(IMAGE_BROWSERS)
  ) {
    return;
  }
  return readdirSync(IMAGE_BROWSERS)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(a.slice(9)) - Number(b.slice(9)))
    .flatMap((name) =>
      // Chrome for Testing builds name the directory chrome-linux64.
      ["chrome-linux64", "chrome-linux"].map((dir) =>
        join(IMAGE_BROWSERS, name, dir, "chrome")
      )
    )
    .filter((path) => existsSync(path))
    .at(-1);
};

export const cloudChromiumConnect = (
  executablePath: string
): WebConnectOptions => ({
  cdpEndpoint: (signal) => {
    running ??= launch(executablePath, signal);
    return running;
  },
});
