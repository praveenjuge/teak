import type { Browser, Page } from "@cloudflare/puppeteer";
import {
  FILES_SCRAPE_LIMITS,
  FILES_SCREENSHOT_SIZE,
  type FilesScrapeResult,
  SCREENSHOT_CLEANUP_CSS,
} from "@teak/files-protocol";
import { sha256Hex } from "./lib";
import { InspectSourceMissing } from "./zip";

/**
 * Browser rendering on Cloudflare Browser Run. Every page runs offline: request
 * interception aborts all network requests and sockets are disabled, so
 * rendering only ever sees bytes this Worker hands it (an R2 object, or HTML
 * that Convex fetched through its DNS-pinned SSRF guard).
 */

export type LaunchBrowser = () => Promise<Browser>;

export const MAX_PDF_SOURCE_BYTES = 20 * 1024 * 1024;
export const MAX_RENDER_HTML_BYTES = 2 * 1024 * 1024;
const MAX_THUMBNAIL_DIMENSION = 1600;
const PAGE_TIMEOUT_MS = 30_000;
// Bytes per DevTools message: 512 KiB of base64, under the 1 MiB message size.
// A multiple of 3, so the chunks' base64 concatenates without padding.
const TRANSFER_CHUNK_BYTES = 384 * 1024;

const PDFJS_VERSION = "3.11.174";
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;
/** Pinned to the cdnjs files (matching their published SRI hashes). */
export const PDFJS_SOURCES = {
  lib: {
    sha256: "5b5799e6f8c680663207ac5b42ee14eed2a406fa7af48f50c154f0c0b1566946",
    url: `${PDFJS_BASE}/pdf.min.js`,
  },
  worker: {
    sha256: "feabdf309770ed24bba31a5467836cdc8cf639c705af27d52b585b041bb8527b",
    url: `${PDFJS_BASE}/pdf.worker.min.js`,
  },
} as const;

export interface PdfJsSources {
  lib: string;
  worker: string;
}

let pdfJsMemo: Promise<PdfJsSources> | null = null;

const fetchPinned = async (
  source: (typeof PDFJS_SOURCES)[keyof typeof PDFJS_SOURCES]
): Promise<string> => {
  const cache = typeof caches === "undefined" ? null : caches.default;
  const cached = await cache?.match(source.url);
  const response = cached ?? (await fetch(source.url));
  if (!response.ok) {
    throw new Error("pdfjs_unavailable");
  }
  const bytes = await response.clone().arrayBuffer();
  if ((await sha256Hex(bytes)) !== source.sha256) {
    throw new Error("pdfjs_integrity_failed");
  }
  const text = new TextDecoder().decode(bytes);
  if (!cached) {
    await cache?.put(source.url, response).catch(() => undefined);
  }
  return text;
};

/** pdf.js for the page, fetched once per isolate and verified by hash. */
export const loadPinnedPdfJs = (): Promise<PdfJsSources> => {
  pdfJsMemo ??= Promise.all([
    fetchPinned(PDFJS_SOURCES.lib),
    fetchPinned(PDFJS_SOURCES.worker),
  ])
    .then(([lib, worker]) => ({ lib, worker }))
    .catch((error) => {
      pdfJsMemo = null;
      throw error;
    });
  return pdfJsMemo;
};

const withPage = async <T>(
  launch: LaunchBrowser,
  viewport: { height: number; width: number },
  run: (page: Page) => Promise<T>
): Promise<T> => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
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
    await browser.close().catch(() => undefined);
  }
};

// --- PDF first page ---------------------------------------------------------

export interface PdfThumbnailResult {
  height: number;
  png: Uint8Array;
  width: number;
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x80_00) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x80_00));
  }
  return btoa(binary);
};

// Encode per chunk so a 20 MiB PDF never also lives as one 27 MiB string in
// the isolate's shared 128 MB.
const base64Chunks = function* (bytes: Uint8Array): Generator<string> {
  for (let offset = 0; offset < bytes.length; offset += TRANSFER_CHUNK_BYTES) {
    yield toBase64(bytes.subarray(offset, offset + TRANSFER_CHUNK_BYTES));
  }
};

/** Render page 1 of a PDF to a white-backed PNG, at most 1600px each way. */
export const renderPdfFirstPage = async (
  launch: LaunchBrowser,
  pdf: Uint8Array,
  pdfJs: PdfJsSources
): Promise<PdfThumbnailResult> =>
  await withPage(launch, { height: 700, width: 800 }, async (page) => {
    await page.setContent(
      '<!doctype html><html><body style="margin:0;background:#fff"></body></html>'
    );
    // Loading the worker script in-page gives pdf.js its main-thread worker,
    // so rendering needs no Worker or blob URL.
    await page.addScriptTag({ content: pdfJs.worker });
    await page.addScriptTag({ content: pdfJs.lib });
    for (const chunk of base64Chunks(pdf)) {
      await page.evaluate((part: string) => {
        const scope = globalThis as unknown as { __pdfChunks?: string[] };
        scope.__pdfChunks ??= [];
        scope.__pdfChunks.push(part);
      }, chunk);
    }
    const size = await page.evaluate(async (maxDimension: number) => {
      // Runs in the page: the Worker's types have no DOM, so describe the
      // few page APIs used here.
      interface PdfViewport {
        height: number;
        width: number;
      }
      interface PdfPage {
        getViewport: (options: { scale: number }) => PdfViewport;
        render: (options: {
          canvasContext: unknown;
          viewport: PdfViewport;
        }) => { promise: Promise<void> };
      }
      interface PageCanvas {
        getContext: (kind: "2d") => {
          fillRect: (x: number, y: number, w: number, h: number) => void;
          fillStyle: string;
        } | null;
        height: number;
        style: { display: string };
        width: number;
      }
      const scope = globalThis as unknown as {
        __pdfChunks?: string[];
        document: {
          body: { replaceChildren: (node: unknown) => void };
          createElement: (tag: "canvas") => PageCanvas;
        };
        pdfjsLib?: {
          getDocument: (source: unknown) => {
            promise: Promise<{ getPage: (index: number) => Promise<PdfPage> }>;
          };
        };
      };
      if (!scope.pdfjsLib) {
        throw new Error("pdf.js failed to load");
      }
      const binary = atob((scope.__pdfChunks ?? []).join(""));
      scope.__pdfChunks = [];
      const data = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) {
        data[index] = binary.charCodeAt(index);
      }
      const document_ = await scope.pdfjsLib.getDocument({
        data,
        isEvalSupported: false,
      }).promise;
      const first = await document_.getPage(1);
      const base = first.getViewport({ scale: 1 });
      if (!(base.width > 0 && base.height > 0)) {
        throw new Error("Invalid PDF page dimensions");
      }
      const scale = Math.min(
        3,
        maxDimension / base.width,
        maxDimension / base.height
      );
      const viewport = first.getViewport({ scale });
      const canvas = scope.document.createElement("canvas");
      canvas.width = Math.max(
        1,
        Math.min(maxDimension, Math.ceil(viewport.width))
      );
      canvas.height = Math.max(
        1,
        Math.min(maxDimension, Math.ceil(viewport.height))
      );
      canvas.style.display = "block";
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Could not get canvas context");
      }
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await first.render({ canvasContext: context, viewport }).promise;
      scope.document.body.replaceChildren(canvas);
      return { height: canvas.height, width: canvas.width };
    }, MAX_THUMBNAIL_DIMENSION);
    await page.setViewport(size);
    const png = await page.screenshot({
      clip: { height: size.height, width: size.width, x: 0, y: 0 },
      type: "png",
    });
    return { ...size, png: new Uint8Array(png) };
  });

export const readPdfSource = async (
  bucket: R2Bucket,
  sourceKey: string
): Promise<Uint8Array> => {
  const object = await bucket.get(sourceKey);
  if (!object) {
    throw new InspectSourceMissing();
  }
  if (object.size > MAX_PDF_SOURCE_BYTES) {
    await object.body.cancel();
    throw new Error("source_too_large");
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  // "%PDF-" may follow up to 1 KiB of leading junk.
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  if (!header.includes("%PDF-")) {
    throw new Error("not_a_pdf");
  }
  return bytes;
};

// --- HTML (screenshot and scrape) ----------------------------------------

/** HTML from Convex arrives gzip-compressed so 2 MiB pages fit in an op body. */
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
        throw new Error("source_too_large");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "source_too_large") {
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
  launch: LaunchBrowser,
  html: string
): Promise<Uint8Array> =>
  await withPage(launch, FILES_SCREENSHOT_SIZE, async (page) => {
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

/** Query selectors against offline HTML, with inline scripts allowed to run. */
export const scrapeHtml = async (
  launch: LaunchBrowser,
  html: string,
  selectors: string[]
): Promise<FilesScrapeResult> =>
  await withPage(launch, FILES_SCREENSHOT_SIZE, async (page) => {
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
