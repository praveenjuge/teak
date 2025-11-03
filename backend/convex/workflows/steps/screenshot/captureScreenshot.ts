"use node";

import { v } from "convex/values";
import type { Id } from "../../../_generated/dataModel";
import { internal } from "../../../_generated/api";
import { internalAction } from "../../../_generated/server";
import { normalizeUrl } from "../../../linkMetadata";
export type ScreenshotRetryableError = {
  type: "rate_limit" | "http_error";
  message?: string;
  details?: unknown;
};

export const SCREENSHOT_RETRYABLE_PREFIX =
  "workflow:screenshot:retryable:";

const throwRetryable = (info: ScreenshotRetryableError): never => {
  throw new Error(`${SCREENSHOT_RETRYABLE_PREFIX}${JSON.stringify(info)}`);
};

const captureScreenshotFromCloudflare = async (
  ctx: any,
  {
    accountId,
    apiToken,
    url,
  }: { accountId: string; apiToken: string; url: string },
): Promise<{
  screenshotId?: Id<"_storage">;
  screenshotUpdatedAt?: number;
  error?: { type: string; message?: string; details?: any };
}> => {
  try {
    const screenshotEndpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/screenshot`;
    const controller = new AbortController();
    const timeoutMs = 30_000;
    const timeoutId = setTimeout(() => {
      console.warn(
        `[screenshot] Screenshot request timeout after ${timeoutMs}ms for ${url}`,
      );
      controller.abort();
    }, timeoutMs);

    const requestBody = {
      url,
      gotoOptions: {
        waitUntil: "networkidle0",
        timeout: 30_000,
      },
      viewport: {
        width: 1_280,
        height: 720,
      },
      screenshotOptions: {
        type: "jpeg" as const,
        quality: 80,
      },
    };

    const response = await fetch(screenshotEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

    if (!response.ok) {
      let responseDetails: string | undefined;
      if (contentType.includes("application/json")) {
        try {
          const errorJson = await response.json();
          responseDetails = JSON.stringify(errorJson)?.slice(0, 2_000);
        } catch (jsonError) {
          console.error(
            `[screenshot] Failed to parse screenshot error JSON for ${url}:`,
            jsonError,
          );
        }
      } else {
        responseDetails = await response.text().catch(() => "<unavailable>");
      }

      console.error(
        `[screenshot] Screenshot HTTP error ${response.status} ${response.statusText} for ${url}:`,
        responseDetails,
      );

      const errorType = response.status === 429 ? "rate_limit" : "http_error";
      return {
        error: {
          type: errorType,
          message: `Screenshot request failed with ${response.status}`,
          details: responseDetails,
        },
      };
    }

    let imageArrayBuffer: ArrayBuffer | undefined;
    let mimeType = "image/jpeg";

    if (contentType.includes("application/json")) {
      const payload = await response.json();
      if (!payload?.success) {
        console.warn(
          `[screenshot] Screenshot payload indicated failure for ${url}`,
          payload?.errors,
        );
        return {
          error: {
            type: "api_error",
            message:
              payload?.errors
                ?.map((error: any) => error?.message)
                .filter(Boolean)
                .join("; ") || "Screenshot capture failed",
            details: payload?.errors,
          },
        };
      }

      const base64Screenshot: string | undefined =
        payload?.result?.screenshot ||
        payload?.result?.image ||
        payload?.result?.png;
      if (!base64Screenshot) {
        console.warn(
          `[screenshot] Screenshot payload missing screenshot data for ${url}`,
        );
        return {
          error: {
            type: "missing_data",
            message: "Screenshot response did not include image data",
          },
        };
      }

      const buffer = Buffer.from(base64Screenshot, "base64");
      imageArrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      );
      mimeType = payload?.result?.type || mimeType;
    } else {
      imageArrayBuffer = await response.arrayBuffer();
      if (contentType) {
        mimeType = contentType.split(";")[0];
      }
    }

    if (!imageArrayBuffer) {
      console.warn(
        `[screenshot] Screenshot response did not include image data for ${url}`,
      );
      return {
        error: {
          type: "missing_data",
          message: "Screenshot response did not include image data",
        },
      };
    }

    const screenshotBlob = new Blob([imageArrayBuffer], {
      type: mimeType,
    });

    const screenshotId = await ctx.storage.store(screenshotBlob);
    return {
      screenshotId,
      screenshotUpdatedAt: Date.now(),
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
  }
};

export const captureScreenshot = internalAction({
  args: {
    cardId: v.id("cards"),
    retryCount: v.optional(v.number()),
  },
  handler: async (ctx, { cardId, retryCount = 0 }) => {
    const card = await ctx.runQuery(internal.linkMetadata.getCardForMetadata, {
      cardId,
    });

    if (!card || card.type !== "link" || !card.url) {
      return;
    }

    const linkPreview = card.metadata?.linkPreview;
    if (!linkPreview || linkPreview.status !== "success") {
      console.log(
        `[screenshot] Skipping screenshot for card ${cardId} because link preview metadata is not ready`,
      );
      return;
    }

    if (linkPreview.screenshotStorageId && retryCount === 0) {
      return;
    }

    const accountId = process.env.CLOUDFLARE_BROWSER_RENDERING_ACCOUNT_ID;
    const apiToken =
      process.env.CLOUDFLARE_BROWSER_RENDERING_API_TOKEN ||
      process.env.CLOUDFLARE_API_TOKEN ||
      process.env.CLOUDFLARE_API_KEY;

    if (!accountId || !apiToken) {
      console.error(
        `[screenshot] Missing Cloudflare credentials for screenshot of card ${cardId}`,
      );
      return;
    }

    const normalizedUrl = normalizeUrl(card.url);
    const screenshotResult = await captureScreenshotFromCloudflare(ctx, {
      accountId,
      apiToken,
      url: normalizedUrl,
    });

    if (screenshotResult?.screenshotId) {
      await ctx.runMutation(internal.linkMetadata.updateCardScreenshot, {
        cardId,
        screenshotStorageId: screenshotResult.screenshotId,
        screenshotUpdatedAt:
          screenshotResult.screenshotUpdatedAt ?? Date.now(),
      });
      console.log(`[screenshot] Stored screenshot for card ${cardId}`);
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
      error,
    );
  },
});
