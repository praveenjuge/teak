"use node";

import { lookup } from "node:dns/promises";
import Kernel from "@onkernel/sdk";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { internalAction } from "../../../_generated/server";
import { normalizeUrl } from "../../../linkMetadata";
import {
  type DnsResolver,
  readBodyWithLimit,
  SsrfError,
  safeFetch,
} from "../../../linkMetadata/ssrf";
import {
  buildSignedWorkerUploadUrl,
  callFilesWorkerJson,
  type FilesWorkerHeadObjectResult,
} from "../../../storage/filesWorkerClient";
import { buildR2ObjectKey } from "../../../storage/r2";
import { pinnedFetch } from "../pinnedFetch";
import {
  SCREENSHOT_RETRYABLE_PREFIX,
  type ScreenshotRetryableError,
} from "./retryable";

// Node runtime DNS resolver injected into the SSRF guard (keeps the guard free
// of Node built-ins so it bundles for any Convex runtime).
const resolveDns: DnsResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

const internalFunctions = internal as Record<string, any>;
const linkMetadataInternal = internalFunctions.linkMetadata as Record<
  string,
  any
>;
const MAX_SCREENSHOT_HTML_BYTES = 2 * 1024 * 1024;

// Re-exported for backwards compatibility; the source of truth lives in
// ./retryable so default-runtime workflow files can import it without dragging
// this "use node" module into the isolate bundle.
export {
  SCREENSHOT_RETRYABLE_PREFIX,
  type ScreenshotRetryableError,
} from "./retryable";

const throwRetryable = (info: ScreenshotRetryableError): never => {
  throw new Error(`${SCREENSHOT_RETRYABLE_PREFIX}${JSON.stringify(info)}`);
};

// Viewport is fixed below; full-viewport JPEG screenshots are exactly this size.
const SCREENSHOT_WIDTH = 1280;
const SCREENSHOT_HEIGHT = 720;

export const buildGenericScreenshotCode = (
  html: string,
  screenshotCss: string,
  uploadUrl: string
): string => `
  await page.route('**/*', route => route.abort());
  await page.addInitScript(() => {
    const blocked = () => { throw new Error('Network access is disabled'); };
    Object.defineProperty(globalThis, 'WebSocket', { value: blocked });
    Object.defineProperty(globalThis, 'EventSource', { value: blocked });
    if (globalThis.navigator) {
      Object.defineProperty(globalThis.navigator, 'sendBeacon', { value: () => false });
    }
  });
  await page.setViewportSize({ width: ${SCREENSHOT_WIDTH}, height: ${SCREENSHOT_HEIGHT} });
  await page.setContent(${JSON.stringify(html)}, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  await page.addStyleTag({ content: ${JSON.stringify(screenshotCss)} });
  const screenshot = await page.screenshot({ type: 'jpeg', quality: 80 });
  // Upload the generated media straight to the Files Worker so the bytes
  // never return to Convex as base64.
  const uploadResponse = await context.request.put(${JSON.stringify(uploadUrl)}, { data: screenshot });
  if (!uploadResponse.ok()) {
    return JSON.stringify({ ok: false, status: uploadResponse.status() });
  }
  return JSON.stringify({ etag: uploadResponse.headers()['etag'] || null, ok: true, status: uploadResponse.status() });
`;

const captureScreenshotWithKernel = async ({
  cardId,
  html,
  url,
  userId,
}: {
  cardId: string;
  html: string;
  url: string;
  userId: string;
}): Promise<{
  screenshotKey?: string;
  screenshotUpdatedAt?: number;
  screenshotWidth?: number;
  screenshotHeight?: number;
  error?: { type: string; message?: string; details?: any };
}> => {
  const kernel = new Kernel();
  let kernelBrowser: { session_id: string } | undefined;

  // Mint a short-lived signed upload URL so the Kernel VM uploads the
  // screenshot directly to the Files Worker; bytes never pass through Convex.
  const screenshotKey = buildR2ObjectKey({
    userId,
    cardId,
    role: "screenshot",
  });
  let uploadUrl: string;
  try {
    uploadUrl = (
      await buildSignedWorkerUploadUrl({
        contentType: "image/jpeg",
        key: screenshotKey,
      })
    ).url;
  } catch (error) {
    console.error("[screenshot] Failed to sign screenshot upload URL", error);
    return {
      error: {
        type: "error",
        message: "Failed to prepare screenshot upload",
      },
    };
  }

  try {
    // Create a browser session
    kernelBrowser = await kernel.browsers.create({
      headless: true,
      stealth: true,
    });

    const screenshotCss = `
      html, body { overflow: hidden !important; scrollbar-width: none !important; -ms-overflow-style: none !important; }
      html::-webkit-scrollbar, body::-webkit-scrollbar { display: none !important; }
      .cookie-banner, .cookie-consent, .privacy-popup, .newsletter-popup, .modal-overlay, .popup, .ad, .advertisement, .sponsored { display: none !important; visibility: hidden !important; }
      body { margin: 0 !important; padding: 0 !important; min-height: 100vh !important; }
      .floating, .sticky, .fixed { display: none !important; }
      [data-testid="BottomBar"], [data-testid="sheetDialog"], [data-testid="HoverCard"], [data-testid="app-bar-close"], [aria-label="Sign up"] { display: none !important; visibility: hidden !important; }
    `;

    const response = await kernel.browsers.playwright.execute(
      kernelBrowser.session_id,
      {
        code: buildGenericScreenshotCode(html, screenshotCss, uploadUrl),
        timeout_sec: 60,
      }
    );

    if (!(response.success && response.result)) {
      console.error(
        `[screenshot] Kernel Playwright execution failed for ${url}:`,
        response.error
      );

      // Check for rate limiting or HTTP errors
      const errorMessage = response.error?.toLowerCase() ?? "";
      if (errorMessage.includes("rate") || errorMessage.includes("limit")) {
        return {
          error: {
            type: "rate_limit",
            message: response.error,
            details: response.stderr,
          },
        };
      }

      return {
        error: {
          type: "http_error",
          message: response.error || "Playwright execution failed",
          details: response.stderr,
        },
      };
    }

    // The VM reports the Files Worker PUT result instead of image bytes.
    let uploadResult: { etag?: string | null; ok: boolean; status?: number };
    try {
      uploadResult = JSON.parse(response.result as string);
    } catch {
      console.warn(`[screenshot] Unparseable upload result for ${url}`);
      return {
        error: {
          type: "missing_data",
          message: "Screenshot upload result was not parseable",
        },
      };
    }
    if (!uploadResult.ok) {
      console.warn(
        `[screenshot] Direct upload failed with status ${uploadResult.status} for ${url}`
      );
      return {
        error: {
          type: "missing_data",
          message: "Screenshot upload to storage failed",
        },
      };
    }

    // Verify the committed object before Convex records it.
    const head = await callFilesWorkerJson<FilesWorkerHeadObjectResult>({
      op: "head-object",
      params: { key: screenshotKey },
    });
    if (
      head.kind !== "ok" ||
      !head.data.exists ||
      !head.data.size ||
      !head.data.contentType?.startsWith("image/")
    ) {
      console.warn(
        `[screenshot] Uploaded screenshot failed verification for ${url}`
      );
      return {
        error: {
          type: "missing_data",
          message: "Uploaded screenshot did not pass verification",
        },
      };
    }

    return {
      screenshotHeight: SCREENSHOT_HEIGHT,
      screenshotKey,
      screenshotUpdatedAt: Date.now(),
      screenshotWidth: SCREENSHOT_WIDTH,
    };
  } catch (error) {
    console.error(`[screenshot] Screenshot capture error for ${url}:`, error);
    let type = "error";
    if ((error as any)?.name === "AbortError") {
      type = "timeout";
    } else if (
      (error as any)?.name === "TypeError" &&
      (error as any)?.message?.includes("fetch")
    ) {
      type = "network_error";
    }
    return {
      error: {
        type,
        message: (error as Error)?.message,
      },
    };
  } finally {
    // Clean up the browser session
    if (kernelBrowser?.session_id) {
      try {
        await kernel.browsers.deleteByID(kernelBrowser.session_id);
      } catch (cleanupError) {
        console.warn(
          "[screenshot] Failed to cleanup browser session:",
          cleanupError
        );
      }
    }
  }
};

export const captureScreenshot = internalAction({
  args: {
    cardId: v.id("cards"),
    retryCount: v.optional(v.number()),
  },
  handler: async (ctx, { cardId, retryCount = 0 }) => {
    const card = await ctx.runQuery(linkMetadataInternal.getCardForMetadata, {
      cardId,
    });

    if (card?.type !== "link" || !card.url) {
      return;
    }

    const linkPreview = card.metadata?.linkPreview;
    if (linkPreview?.status !== "success") {
      return;
    }

    if (linkPreview.screenshotStorageKey && retryCount === 0) {
      return;
    }

    const normalizedUrl = normalizeUrl(card.url);

    let html: string;
    try {
      const response = await safeFetch(
        normalizedUrl,
        resolveDns,
        {
          headers: {
            accept: "text/html,application/xhtml+xml",
            "user-agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        },
        pinnedFetch
      );
      const contentType = response.headers.get("content-type") ?? "";
      if (!(response.ok && contentType.toLowerCase().includes("text/html"))) {
        return;
      }
      html = new TextDecoder().decode(
        await readBodyWithLimit(response, MAX_SCREENSHOT_HTML_BYTES)
      );
    } catch (error) {
      if (error instanceof SsrfError) {
        console.warn(
          `[screenshot] Skipping screenshot for card ${cardId}: ${error.reason}`
        );
        return;
      }
      throw error;
    }

    const screenshotResult = await captureScreenshotWithKernel({
      cardId,
      html,
      url: normalizedUrl,
      userId: card.userId,
    });

    if (screenshotResult?.screenshotKey) {
      await ctx.runMutation(linkMetadataInternal.updateCardScreenshot, {
        cardId,
        screenshotStorageKey: screenshotResult.screenshotKey,
        screenshotUpdatedAt: screenshotResult.screenshotUpdatedAt ?? Date.now(),
        screenshotWidth: screenshotResult.screenshotWidth,
        screenshotHeight: screenshotResult.screenshotHeight,
      });
      return;
    }

    const error = screenshotResult?.error;
    if (!error) {
      return;
    }

    if (error.type === "rate_limit" || error.type === "http_error") {
      throwRetryable({
        type: error.type,
        message: error.message,
        details: error.details,
      });
    }

    console.warn(
      `[screenshot] Screenshot capture failed for card ${cardId}:`,
      error
    );
  },
});
