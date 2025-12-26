"use node";

import { v } from "convex/values";
import Kernel from "@onkernel/sdk";
import { PhotonImage } from "@cf-wasm/photon";
import { internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { ScrapeResponse } from "../../../linkMetadata";
import {
  buildErrorPreview,
  buildSuccessPreview,
  buildInstagramPrimaryImageSnippet,
  isInstagramUrl,
  normalizeUrl,
  parseLinkPreview,
  SCRAPE_ELEMENTS,
} from "../../../linkMetadata";
import type { Id } from "../../../shared/types";

export type LinkMetadataRetryableError = {
  type: string;
  message?: string;
  normalizedUrl?: string;
  details?: unknown;
};

export const LINK_METADATA_RETRYABLE_PREFIX =
  "workflow:linkMetadata:retryable:";

const internalFunctions = internal as Record<string, any>;
const linkMetadataInternal = internalFunctions["linkMetadata"] as Record<string, any>;

const throwRetryable = (info: LinkMetadataRetryableError): never => {
  throw new Error(`${LINK_METADATA_RETRYABLE_PREFIX}${JSON.stringify(info)}`);
};

type StoredLinkImage = {
  imageStorageId: Id<"_storage">;
  imageUpdatedAt: number;
  imageWidth: number;
  imageHeight: number;
};

const readImageDimensions = (bytes: Uint8Array): { width: number; height: number } | null => {
  try {
    const image = PhotonImage.new_from_byteslice(bytes);
    const width = image.get_width();
    const height = image.get_height();
    return width && height ? { width, height } : null;
  } catch (error) {
    console.warn("[linkMetadata] Failed to read OG image dimensions", error);
    return null;
  }
};

const guessImageContentType = (imageUrl: string): string | null => {
  const match = imageUrl.toLowerCase().match(/\.(png|jpe?g|webp|gif|avif|svg)(?:[?#]|$)/);
  if (!match) {
    return null;
  }
  switch (match[1]) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "avif":
      return "image/avif";
    case "svg":
      return "image/svg+xml";
    default:
      return null;
  }
};

const resolveImageContentType = (headerValue: string | null, imageUrl: string): string | null => {
  if (headerValue && headerValue.toLowerCase().startsWith("image/")) {
    return headerValue.split(";")[0]?.trim() || headerValue;
  }
  if (imageUrl.startsWith("data:")) {
    const commaIndex = imageUrl.indexOf(",");
    if (commaIndex === -1) {
      return null;
    }
    const metadata = imageUrl.slice(5, commaIndex);
    const dataType = metadata.split(";")[0];
    return dataType || null;
  }
  return guessImageContentType(imageUrl);
};

const storeLinkPreviewImage = async (
  ctx: any,
  imageUrl: string,
): Promise<StoredLinkImage | null> => {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.warn(
        `[linkMetadata] OG image fetch failed (${response.status}) for ${imageUrl}`,
      );
      return null;
    }

    const contentType = resolveImageContentType(
      response.headers.get("content-type"),
      imageUrl,
    );
    if (!contentType) {
      console.warn(
        `[linkMetadata] OG image skipped due to unknown content type for ${imageUrl}`,
      );
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const dimensions = readImageDimensions(bytes);
    if (!dimensions) {
      return null;
    }

    const imageBlob = new Blob([arrayBuffer], { type: contentType });
    const imageStorageId = await ctx.storage.store(imageBlob);

    return {
      imageStorageId,
      imageUpdatedAt: Date.now(),
      imageWidth: dimensions.width,
      imageHeight: dimensions.height,
    };
  } catch (error) {
    console.warn("[linkMetadata] OG image fetch error", error);
    return null;
  }
};

const scrapeWithKernel = async (
  url: string,
  selectors: { selector: string }[]
): Promise<ScrapeResponse> => {
  const kernel = new Kernel();
  let kernelBrowser: { session_id: string } | undefined;

  try {
    kernelBrowser = await kernel.browsers.create({
      stealth: true,
    });

    const selectorStrings = selectors.map(s => s.selector);
    const instagramPrimaryImageSnippet = buildInstagramPrimaryImageSnippet();
    const code = `
      await page.goto('${url.replace(/'/g, "\\'")}', { waitUntil: 'networkidle', timeout: 30000 });

      const selectors = ${JSON.stringify(selectorStrings)};
      const results = [];

      for (const selector of selectors) {
        try {
          const elements = await page.$$(selector);
          const selectorResults = [];

          for (const element of elements) {
            const text = await element.textContent().catch(() => null);
            const html = await element.innerHTML().catch(() => null);

            const attributes = await element.evaluate(el => {
              return Array.from(el.attributes).map(attr => ({
                name: attr.name,
                value: attr.value
              }));
            }).catch(() => []);

            selectorResults.push({
              text: text?.trim() || undefined,
              html: html?.trim() || undefined,
              attributes: attributes.length > 0 ? attributes : undefined
            });
          }

          results.push({
            selector,
            results: selectorResults
          });
        } catch (e) {
          results.push({
            selector,
            results: []
          });
        }
      }

      let primaryImage = null;
${instagramPrimaryImageSnippet}

      return {
        selectors: results,
        primaryImage: primaryImage || undefined
      };
    `;

    const response = await kernel.browsers.playwright.execute(
      kernelBrowser.session_id,
      {
        code,
        timeout_sec: 35,
      }
    );

    if (!response.success) {
      return {
        success: false,
        errors: [{ message: response.error || "Playwright execution failed" }],
      };
    }

    return {
      success: true,
      result: response.result as ScrapeResponse["result"],
    };
  } catch (error) {
    return {
      success: false,
      errors: [{ message: (error as Error)?.message || "Unknown error" }],
    };
  } finally {
    if (kernelBrowser?.session_id) {
      try {
        await kernel.browsers.deleteByID(kernelBrowser.session_id);
      } catch (cleanupError) {
        console.warn(
          `[linkMetadata] Failed to cleanup browser session:`,
          cleanupError
        );
      }
    }
  }
};

export const fetchMetadataHandler = async (ctx: any, { cardId }: any) => {
  const card = await ctx.runQuery(linkMetadataInternal.getCardForMetadata, {
    cardId,
  });

  if (!card || !card.url) {
    await ctx.runMutation(linkMetadataInternal.updateCardMetadata, {
      cardId,
      linkPreview: buildErrorPreview(card?.url ?? "", {
        type: "invalid_card",
        message: "Card is missing a valid URL",
      }),
      status: "failed",
    });
    return {
      status: "failed" as const,
      errorType: "invalid_card",
      errorMessage: "Card is missing a valid URL",
    };
  }

  const classificationStatus = card.processingStatus?.classify?.status;
  const classificationPending =
    !classificationStatus ||
    classificationStatus === "pending" ||
    classificationStatus === "in_progress";

  if (card.type !== "link") {
    if (classificationPending) {
      throwRetryable({
        type: "awaiting_classification",
        normalizedUrl: card.url,
        message: "Waiting for classification to finish",
      });
    }

    await ctx.runMutation(linkMetadataInternal.updateCardMetadata, {
      cardId,
      linkPreview: buildErrorPreview(card.url ?? "", {
        type: "invalid_card",
        message: "Card is not a link",
      }),
      status: "failed",
    });
    return {
      status: "failed" as const,
      errorType: "invalid_card",
      errorMessage: "Card is not a link",
    };
  }

  const normalizedUrl = normalizeUrl(card.url);

  try {
    const payload = await scrapeWithKernel(normalizedUrl, SCRAPE_ELEMENTS);

    if (!payload.success) {
      const errorMessage = payload.errors
        ?.map((error) => error?.message)
        .filter(Boolean)
        .join("; ") || "Unknown scrape error";

      console.warn(
        `[linkMetadata] Kernel scrape failed for ${normalizedUrl}`,
        payload.errors,
      );

      const isRateLimit = errorMessage.toLowerCase().includes("rate") ||
        errorMessage.toLowerCase().includes("limit");

      if (isRateLimit) {
        throwRetryable({
          type: "rate_limit",
          normalizedUrl,
          message: errorMessage,
          details: payload.errors,
        });
      }

      throwRetryable({
        type: "scrape_error",
        normalizedUrl,
        message: errorMessage,
        details: payload.errors,
      });
    }

    const parsed = parseLinkPreview(normalizedUrl, payload.result?.selectors);
    const primaryImageCandidate = payload.result?.primaryImage?.url;
    const primaryImageUrl =
      primaryImageCandidate && isInstagramUrl(normalizedUrl)
        ? primaryImageCandidate
        : undefined;
    const resolvedImageUrl = primaryImageUrl ?? parsed.imageUrl;
    const parsedWithPrimary = resolvedImageUrl
      ? { ...parsed, imageUrl: resolvedImageUrl }
      : parsed;
    const storedImage = resolvedImageUrl
      ? await storeLinkPreviewImage(ctx, resolvedImageUrl)
      : null;
    const linkPreview = buildSuccessPreview(normalizedUrl, {
      ...parsedWithPrimary,
      ...(storedImage ?? {}),
    });

    await ctx.runMutation(linkMetadataInternal.updateCardMetadata, {
      cardId,
      linkPreview,
      status: "completed",
    });

    // Note: Do NOT call startCardProcessingWorkflow here.
    // The main cardProcessingWorkflow already handles link metadata extraction
    // and will continue with subsequent steps after this completes.

    return {
      status: "success" as const,
      normalizedUrl,
      linkPreview,
    };
  } catch (error) {
    console.error(
      `[linkMetadata] Error extracting metadata for card ${cardId}:`,
      error,
    );

    if ((error as Error)?.message?.startsWith(LINK_METADATA_RETRYABLE_PREFIX)) {
      throw error;
    }

    if ((error as any)?.name === "AbortError") {
      throwRetryable({
        type: "timeout",
        normalizedUrl,
        message: (error as Error)?.message,
      });
    }

    if (
      (error as any)?.name === "TypeError" &&
      (error as any)?.message?.includes("fetch")
    ) {
      throwRetryable({
        type: "network_error",
        normalizedUrl,
        message: (error as Error)?.message,
      });
    }

    await ctx.runMutation(linkMetadataInternal.updateCardMetadata, {
      cardId,
      linkPreview: buildErrorPreview(normalizedUrl ?? card.url, {
        type: "error",
        message: (error as Error)?.message,
      }),
      status: "failed",
    });

    return {
      status: "failed" as const,
      normalizedUrl,
      errorType: "error",
      errorMessage: (error as Error)?.message,
    };
  }
};

export const fetchMetadata = internalAction({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.object({
    status: v.union(v.literal("success"), v.literal("failed")),
    normalizedUrl: v.optional(v.string()),
    linkPreview: v.optional(v.any()),
    errorType: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  }),
  handler: fetchMetadataHandler,
});
