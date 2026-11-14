import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer, { type Browser } from "@cloudflare/puppeteer";
import type { AcquireBrowser } from "../media/browserSessions";

/**
 * A real local Chrome driven through @cloudflare/puppeteer, standing in for the
 * Browser Run binding in tests. GitHub's ubuntu runners ship Google Chrome;
 * elsewhere the Playwright browser cache is used.
 */
const candidates = (): string[] => {
  const paths = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const root of [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    "/opt/pw-browsers",
    `${process.env.HOME}/.cache/ms-playwright`,
  ]) {
    if (!(root && existsSync(root))) {
      continue;
    }
    // Chrome for Testing builds use the `*-linux64` layout; older Playwright
    // builds use `chrome-linux`.
    for (const entry of readdirSync(root).sort().reverse()) {
      if (entry.startsWith("chromium_headless_shell-")) {
        paths.push(
          `${root}/${entry}/chrome-headless-shell-linux64/chrome-headless-shell`,
          `${root}/${entry}/chrome-linux/headless_shell`
        );
      } else if (entry.startsWith("chromium-")) {
        paths.push(
          `${root}/${entry}/chrome-linux64/chrome`,
          `${root}/${entry}/chrome-linux/chrome`
        );
      }
    }
  }
  return paths.filter((path): path is string => Boolean(path));
};

export const localChromePath = (): string => {
  const found = candidates().find((path) => existsSync(path));
  if (!found) {
    throw new Error(
      "No local Chrome found; set CHROME_PATH or install Playwright Chromium"
    );
  }
  return found;
};

// The address ends its line, so a chunk cut mid-address doesn't match.
const DEVTOOLS_URL = /ws:\/\/\S+(?=\s)/u;

/**
 * Reads a stream until `pattern` shows up or `timeoutMs` passes, whichever
 * comes first, even if the stream goes quiet. Returns the first match, or
 * null with everything read so far.
 */
export const readUntil = async (
  stream: ReadableStream<Uint8Array>,
  pattern: RegExp,
  timeoutMs: number
): Promise<{ match: string | null; output: string }> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let output = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    let ended = false;
    let remaining = timeoutMs;
    while (!(ended || pattern.test(output) || remaining <= 0)) {
      const timedOut = new Promise<{ done: true; value: undefined }>(
        (resolve) => {
          timer = setTimeout(
            () => resolve({ done: true, value: undefined }),
            remaining
          );
        }
      );
      const { done, value } = await Promise.race([reader.read(), timedOut]);
      clearTimeout(timer);
      if (value) {
        output += decoder.decode(value, { stream: true });
      }
      ended = done;
      remaining = deadline - Date.now();
    }
    return { match: output.match(pattern)?.[0] ?? null, output };
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
};

export const launchLocalChrome = async (): Promise<Browser> => {
  // A fresh profile per launch, as Puppeteer's own launcher does: the
  // runner's default Google Chrome profile can stall a cold start on its
  // first-run work or on another Chrome holding its lock.
  const profile = mkdtempSync(join(tmpdir(), "teak-chrome-"));
  const removeProfile = () => rmSync(profile, { force: true, recursive: true });
  const chrome = Bun.spawn(
    [
      localChromePath(),
      "--headless=new",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--no-sandbox",
      "--disable-gpu",
      "--remote-debugging-port=0",
      // Let pages reach the loopback test server, so a request that escapes
      // the offline page is observed instead of blocked by Chrome itself.
      "--disable-features=PrivateNetworkAccessSendPreflights,BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks",
      "about:blank",
    ],
    { stderr: "pipe", stdout: "ignore" }
  );
  // A cold Chrome on a CI runner can take more than 15 s to print its
  // DevTools address; the tests that call this allow 60 s in all.
  const found = await readUntil(chrome.stderr, DEVTOOLS_URL, 45_000);
  if (!found.match) {
    chrome.kill();
    removeProfile();
    throw new Error(`Chrome did not start: ${found.output.slice(-500)}`);
  }
  const browser = await puppeteer.connect({
    browserWSEndpoint: found.match,
  });
  browser.on("disconnected", () => {
    chrome.kill();
    chrome.exited.then(removeProfile, removeProfile);
  });
  return browser;
};

export const localChromeLease: AcquireBrowser = async () => {
  const browser = await launchLocalChrome();
  return { browser, release: () => browser.close() };
};
