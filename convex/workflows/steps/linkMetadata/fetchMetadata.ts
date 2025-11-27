"use node";

import { v } from "convex/values";
import Kernel from "@onkernel/sdk";
import { internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { ScrapeResponse } from "../../../linkMetadata";
import {
  buildErrorPreview,
  buildSuccessPreview,
  normalizeUrl,
  parseLinkPreview,
  SCRAPE_ELEMENTS,
} from "../../../linkMetadata";

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
const workflowManagerInternal = internalFunctions["workflows/manager"] as Record<string, any>;

const throwRetryable = (info: LinkMetadataRetryableError): never => {
  throw new Error(`${LINK_METADATA_RETRYABLE_PREFIX}${JSON.stringify(info)}`);
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
      
      return results;
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
  handler: async (ctx, { cardId }) => {

    const card = await ctx.runQuery(linkMetadataInternal.getCardForMetadata, {
      cardId,
    });

    if (!card || !card.url) {
      console.error(
        `[linkMetadata] Card ${cardId} is not a valid link card (card type = ${card?.type})`,
      );
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

      console.error(
        `[linkMetadata] Card ${cardId} is not a valid link card (card type = ${card?.type})`,
      );
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
    console.log(
      `[linkMetadata] Extracting metadata for card ${cardId}, URL: ${normalizedUrl}`,
    );

    try {
      console.log(
        `[linkMetadata] Calling Kernel Playwright with ${SCRAPE_ELEMENTS.length} selectors`,
      );
      const startedAt = Date.now();

      const payload = await scrapeWithKernel(normalizedUrl, SCRAPE_ELEMENTS);

      console.log(
        `[linkMetadata] Kernel response received in ${Date.now() - startedAt}ms`,
      );

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

      const parsed = parseLinkPreview(normalizedUrl, payload.result);
      const linkPreview = buildSuccessPreview(normalizedUrl, parsed);

      await ctx.runMutation(linkMetadataInternal.updateCardMetadata, {
        cardId,
        linkPreview,
        status: "completed",
      });

      console.log(`[linkMetadata] Metadata extracted for card ${cardId}`, {
        title: Boolean(linkPreview.title),
        description: Boolean(linkPreview.description),
        image: Boolean(linkPreview.imageUrl),
        favicon: Boolean(linkPreview.faviconUrl),
        siteName: Boolean(linkPreview.siteName),
        finalUrl: linkPreview.finalUrl,
      });

      await ctx.scheduler.runAfter(
        0,
        workflowManagerInternal.startCardProcessingWorkflow,
        { cardId },
      );

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
  },
});
