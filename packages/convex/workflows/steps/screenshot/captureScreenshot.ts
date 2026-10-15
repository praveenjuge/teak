"use node";

import { lookup } from "node:dns/promises";
import { gzipSync } from "node:zlib";
import type { FilesCaptureScreenshotResult } from "@teak/files-protocol";
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
  type FilesWorkerRenderingOutcome,
  runFilesWorkerRendering,
} from "../../../storage/filesWorkerRendering";
import { ensureObjectOwnership } from "../../../storage/ownership";
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

const throwRetryable = (info: ScreenshotRetryableError): never => {
  throw new Error(`${SCREENSHOT_RETRYABLE_PREFIX}${JSON.stringify(info)}`);
};

const gzipBase64 = (html: string): string =>
  gzipSync(Buffer.from(html, "utf8")).toString("base64");

const isNetworkError = (error: unknown) =>
  (error as { name?: string })?.name === "AbortError" ||
  ((error as { name?: string })?.name === "TypeError" &&
    String((error as Error)?.message).includes("fetch"));

const screenshotOutcomeValidator = v.union(
  v.object({ status: v.literal("captured") }),
  v.object({ status: v.literal("skipped") }),
  v.object({ status: v.literal("failed"), reason: v.string() })
);

/**
 * Fetch the link's HTML through the SSRF guard and screenshot it offline with
 * Browser Run on the Files Worker. Pages that cannot be captured (unsafe
 * URLs, HTTP errors, non-HTML) resolve to `failed`; a busy or unavailable
 * renderer and network errors throw a retryable error for the workflow.
 */
export const captureScreenshot = internalAction({
  args: {
    cardId: v.id("cards"),
    retryCount: v.optional(v.number()),
  },
  returns: screenshotOutcomeValidator,
  handler: async (ctx, { cardId, retryCount = 0 }) => {
    const card = await ctx.runQuery(linkMetadataInternal.getCardForScreenshot, {
      cardId,
    });
    if (card?.type !== "link" || !card.url) {
      return { status: "skipped" as const };
    }
    const linkPreview = card.metadata?.linkPreview;
    if (linkPreview?.status !== "success") {
      return { status: "skipped" as const };
    }
    if (linkPreview.screenshotStorageKey && retryCount === 0) {
      return { status: "skipped" as const };
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
      if (response.status >= 500 || response.status === 429) {
        await response.body?.cancel().catch(() => undefined);
        throwRetryable({
          type: "http_error",
          message: `HTTP ${response.status}`,
        });
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { status: "failed" as const, reason: `http_${response.status}` };
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("text/html")) {
        await response.body?.cancel().catch(() => undefined);
        return { status: "failed" as const, reason: "not_html" };
      }
      html = new TextDecoder().decode(
        await readBodyWithLimit(response, MAX_SCREENSHOT_HTML_BYTES)
      );
    } catch (error) {
      if (error instanceof SsrfError) {
        console.warn(
          `[screenshot] Skipping screenshot for card ${cardId}: ${error.reason}`
        );
        return { status: "failed" as const, reason: "blocked_url" };
      }
      if (isNetworkError(error)) {
        throwRetryable({
          type: "http_error",
          message: (error as Error)?.message,
        });
      }
      throw error;
    }

    const screenshotKey = buildR2ObjectKey({
      userId: card.userId,
      cardId,
      role: "screenshot",
    });
    await ensureObjectOwnership(ctx, card.userId, screenshotKey);

    let outcome: FilesWorkerRenderingOutcome<FilesCaptureScreenshotResult>;
    try {
      outcome = await runFilesWorkerRendering<FilesCaptureScreenshotResult>(
        "capture-screenshot",
        { destinationKey: screenshotKey, htmlGzipBase64: gzipBase64(html) }
      );
    } catch (error) {
      console.warn(`[screenshot] Renderer unavailable for card ${cardId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return throwRetryable({
        type: "renderer_unavailable",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (outcome.kind === "declined") {
      console.warn(
        `[screenshot] Renderer declined card ${cardId}: ${outcome.reason}`
      );
      return {
        status: "failed" as const,
        reason: `declined:${outcome.reason}`.slice(0, 200),
      };
    }

    await ctx.runMutation(linkMetadataInternal.updateCardScreenshot, {
      cardId,
      screenshotStorageKey: screenshotKey,
      screenshotUpdatedAt: Date.now(),
      screenshotWidth: outcome.data.width,
      screenshotHeight: outcome.data.height,
    });
    return { status: "captured" as const };
  },
});
