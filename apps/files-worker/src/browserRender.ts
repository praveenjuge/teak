import type { BrowserContext, Page } from "@cloudflare/puppeteer";
import {
  FILES_SCRAPE_LIMITS,
  FILES_SCREENSHOT_SIZE,
  type FilesScrapeResult,
  SCREENSHOT_CLEANUP_CSS,
} from "@teak/files-protocol";
import type { AcquireBrowser } from "./browserSessions";
import { OpFailure } from "./opFailure";

export const MAX_RENDER_HTML_BYTES = 2 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 30_000;

const withPage = async <T>(
  acquire: AcquireBrowser,
  viewport: { height: number; width: number },
  run: (page: Page) => Promise<T>
): Promise<T> => {
  const { browser, release } = await acquire();
  let context: BrowserContext | null = null;
  try {
    context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      request.abort().catch(() => undefined);
    });
    await page.evaluateOnNewDocument(() => {
      const blocked = () => {
        throw new Error("Network access is disabled");
      };
      const scope = globalThis as unknown as { navigator?: object };
      Object.defineProperty(scope, "WebSocket", { value: blocked });
      Object.defineProperty(scope, "EventSource", { value: blocked });
      if (scope.navigator) {
        Object.defineProperty(scope.navigator, "sendBeacon", {
          value: () => false,
        });
      }
    });
    // The script above only applies to new documents, and setContent writes
    // into the current one; WebSockets also bypass request interception.
    await page.goto("about:blank");
    await page.setViewport(viewport);
    return await run(page);
  } finally {
    await context?.close().catch(() => undefined);
    await release().catch(() => undefined);
  }
};

export const decodeHtmlParam = async (value: unknown): Promise<string> => {
  if (typeof value !== "string" || !value) {
    throw new Error("invalid_html");
  }
  let compressed: Uint8Array;
  try {
    compressed = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    throw new Error("invalid_html");
  }
  const reader = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) {
        break;
      }
      total += chunk.byteLength;
      if (total > MAX_RENDER_HTML_BYTES) {
        await reader.cancel();
        throw new OpFailure("source_too_large");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof OpFailure && error.code === "source_too_large") {
      throw error;
    }
    throw new Error("invalid_html");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

export const captureHtmlScreenshot = async (
  acquire: AcquireBrowser,
  html: string
): Promise<Uint8Array> =>
  await withPage(acquire, FILES_SCREENSHOT_SIZE, async (page) => {
    await page.setContent(html, {
      timeout: PAGE_TIMEOUT_MS,
      waitUntil: "domcontentloaded",
    });
    await page.addStyleTag({ content: SCREENSHOT_CLEANUP_CSS });
    return new Uint8Array(await page.screenshot({ quality: 80, type: "jpeg" }));
  });

export const validScrapeSelectors = (value: unknown): string[] => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > FILES_SCRAPE_LIMITS.selectors ||
    value.some(
      (selector) =>
        typeof selector !== "string" ||
        !selector ||
        selector.length > FILES_SCRAPE_LIMITS.selectorChars
    )
  ) {
    throw new Error("invalid_selectors");
  }
  return value as string[];
};

export const scrapeHtml = async (
  acquire: AcquireBrowser,
  html: string,
  selectors: string[]
): Promise<FilesScrapeResult> =>
  await withPage(acquire, FILES_SCREENSHOT_SIZE, async (page) => {
    await page.setContent(html, {
      timeout: 20_000,
      waitUntil: "domcontentloaded",
    });
    const results: FilesScrapeResult["selectors"] = [];
    for (const selector of selectors) {
      const matches = await page
        .$$eval(
          selector,
          (elements, limits) =>
            elements.slice(0, limits.elements).map((node) => {
              const element = node as unknown as {
                attributes: ArrayLike<{ name: string; value: string }>;
                innerHTML: string;
                textContent: string | null;
              };
              const text = element.textContent?.trim() || undefined;
              const html = element.innerHTML.trim() || undefined;
              const attributes = Array.from(element.attributes).map(
                (attribute) => ({
                  name: attribute.name,
                  value: attribute.value.slice(0, limits.valueChars),
                })
              );
              return {
                attributes: attributes.length ? attributes : undefined,
                html: html?.slice(0, limits.valueChars),
                text: text?.slice(0, limits.valueChars),
              };
            }),
          FILES_SCRAPE_LIMITS
        )
        .catch(() => []);
      results.push({ results: matches, selector });
    }
    return { selectors: results };
  });
