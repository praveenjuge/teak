import { existsSync, readdirSync } from "node:fs";
import puppeteer, { type Browser } from "@cloudflare/puppeteer";

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
    for (const entry of readdirSync(root).sort().reverse()) {
      if (entry.startsWith("chromium_headless_shell-")) {
        paths.push(`${root}/${entry}/chrome-linux/headless_shell`);
      } else if (entry.startsWith("chromium-")) {
        paths.push(`${root}/${entry}/chrome-linux/chrome`);
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

/** Launch a fresh Chrome; `browser.close()` ends the process. */
export const launchLocalChrome = async (): Promise<Browser> => {
  const chrome = Bun.spawn(
    [
      localChromePath(),
      "--headless=new",
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
  const reader = chrome.stderr.getReader();
  const decoder = new TextDecoder();
  let output = "";
  const deadline = Date.now() + 15_000;
  while (!/ws:\/\/\S+/u.test(output)) {
    const { done, value } = await reader.read();
    if (done || Date.now() > deadline) {
      chrome.kill();
      throw new Error(`Chrome did not start: ${output.slice(-500)}`);
    }
    output += decoder.decode(value);
  }
  reader.releaseLock();
  const browser = await puppeteer.connect({
    browserWSEndpoint: (output.match(/ws:\/\/\S+/u) as RegExpMatchArray)[0],
  });
  browser.on("disconnected", () => chrome.kill());
  return browser;
};
