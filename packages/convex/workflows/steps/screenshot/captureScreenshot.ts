"use node";

import { PhotonImage } from "@cf-wasm/photon";
import Kernel from "@onkernel/sdk";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { internalAction } from "../../../_generated/server";
import { normalizeUrl } from "../../../linkMetadata";
import type { Id } from "../../../shared/types";

const internalFunctions = internal as Record<string, any>;
const linkMetadataInternal = internalFunctions.linkMetadata as Record<
  string,
  any
>;
export type ScreenshotRetryableError = {
  type: "rate_limit" | "http_error";
  message?: string;
  details?: unknown;
};

export const SCREENSHOT_RETRYABLE_PREFIX = "workflow:screenshot:retryable:";

const throwRetryable = (info: ScreenshotRetryableError): never => {
  throw new Error(`${SCREENSHOT_RETRYABLE_PREFIX}${JSON.stringify(info)}`);
};

const captureScreenshotWithKernel = async (
  ctx: any,
  { url }: { url: string }
): Promise<{
  screenshotId?: Id<"_storage">;
  screenshotUpdatedAt?: number;
  screenshotWidth?: number;
  screenshotHeight?: number;
  error?: { type: string; message?: string; details?: any };
}> => {
  const kernel = new Kernel();
  let kernelBrowser: { session_id: string } | undefined;

  try {
    // Create a browser session
    kernelBrowser = await kernel.browsers.create({
      stealth: true,
    });

    const screenshotCss = `
      html, body { overflow: hidden !important; scrollbar-width: none !important; -ms-overflow-style: none !important; }
      html::-webkit-scrollbar, body::-webkit-scrollbar { display: none !important; }
      .cookie-banner, .cookie-consent, .privacy-popup, .newsletter-popup, .modal-overlay, .popup, .ad, .advertisement, .sponsored { display: none !important; visibility: hidden !important; }
      body { margin: 0 !important; padding: 0 !important; min-height: 100vh !important; }
      .floating, .sticky, .fixed { display: none !important; }
    `;

    // Execute Playwright code to capture screenshot
    const response = await kernel.browsers.playwright.execute(
      kernelBrowser.session_id,
      {
        code: `
          await page.setViewportSize({ width: 1280, height: 720 });
          await page.goto('${url.replace(/'/g, "\\'")}', { waitUntil: 'networkidle', timeout: 30000 });
          await page.addStyleTag({ content: \`${screenshotCss.replace(/`/g, "\\`")}\` });
          const screenshot = await page.screenshot({ type: 'jpeg', quality: 80 });
          return screenshot.toString('base64');
        `,
        timeout_sec: 60,
      }
    );

    if (!response.success) {
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

    const base64Screenshot = response.result as string;
    if (!base64Screenshot) {
      console.warn(`[screenshot] Screenshot response missing data for ${url}`);
      return {
        error: {
          type: "missing_data",
          message: "Screenshot response did not include image data",
        },
      };
    }

    const buffer = Buffer.from(base64Screenshot, "base64");
    let screenshotWidth: number | undefined;
    let screenshotHeight: number | undefined;
    try {
      const image = PhotonImage.new_from_byteslice(buffer);
      screenshotWidth = image.get_width();
      screenshotHeight = image.get_height();
    } catch (error) {
      console.warn("[screenshot] Failed to read screenshot dimensions", error);
    }
    const imageArrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );

    const screenshotBlob = new Blob([imageArrayBuffer], {
      type: "image/jpeg",
    });

    const screenshotId = await ctx.storage.store(screenshotBlob);
    return {
      screenshotId,
      screenshotUpdatedAt: Date.now(),
      screenshotWidth,
      screenshotHeight,
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

    if (!card || card.type !== "link" || !card.url) {
      return;
    }

    const linkPreview = card.metadata?.linkPreview;
    if (!linkPreview || linkPreview.status !== "success") {
      return;
    }

    if (linkPreview.screenshotStorageId && retryCount === 0) {
      return;
    }

    const normalizedUrl = normalizeUrl(card.url);
    const screenshotResult = await captureScreenshotWithKernel(ctx, {
      url: normalizedUrl,
    });

    if (screenshotResult?.screenshotId) {
      await ctx.runMutation(linkMetadataInternal.updateCardScreenshot, {
        cardId,
        screenshotStorageId: screenshotResult.screenshotId,
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
