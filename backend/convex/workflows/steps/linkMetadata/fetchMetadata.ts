"use node";

import { v } from "convex/values";
import { internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { CloudflareScrapeResponse } from "../../../linkMetadata";
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
    let normalizedUrl: string | undefined;

    const card = await ctx.runQuery(linkMetadataInternal.getCardForMetadata, {
      cardId,
    });

    if (!card || card.type !== "link" || !card.url) {
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

    normalizedUrl = normalizeUrl(card.url);
    console.log(
      `[linkMetadata] Extracting metadata for card ${cardId}, URL: ${normalizedUrl}`,
    );

    const accountId = process.env.CLOUDFLARE_BROWSER_RENDERING_ACCOUNT_ID;
    const apiToken =
      process.env.CLOUDFLARE_BROWSER_RENDERING_API_TOKEN ||
      process.env.CLOUDFLARE_API_TOKEN ||
      process.env.CLOUDFLARE_API_KEY;

    if (!accountId || !apiToken) {
      console.error(
        `[linkMetadata] Missing Cloudflare Browser Rendering credentials (accountId=${accountId ? "set" : "missing"}, apiToken=${apiToken ? "set" : "missing"})`,
      );
      await ctx.runMutation(linkMetadataInternal.updateCardMetadata, {
        cardId,
        linkPreview: buildErrorPreview(normalizedUrl, {
          type: "configuration_error",
          message:
            "Cloudflare Browser Rendering credentials are not configured",
        }),
        status: "failed",
      });
      return {
        status: "failed" as const,
        normalizedUrl,
        errorType: "configuration_error",
        errorMessage:
          "Cloudflare Browser Rendering credentials are not configured",
      };
    }

    try {
      const scrapeUrl = new URL(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/scrape`,
      );
      scrapeUrl.searchParams.set("cacheTTL", "0");

      const controller = new AbortController();
      const timeoutMs = 25_000;
      const timeoutId = setTimeout(() => {
        console.warn(
          `[linkMetadata] Cloudflare request timeout after ${timeoutMs}ms for ${normalizedUrl}`,
        );
        controller.abort();
      }, timeoutMs);

      const requestPayload = {
        url: normalizedUrl,
        elements: SCRAPE_ELEMENTS,
        gotoOptions: {
          waitUntil: "networkidle0",
          timeout: 30_000,
        },
      };

      console.log(
        `[linkMetadata] Calling Cloudflare Browser Rendering /scrape with ${SCRAPE_ELEMENTS.length} selectors`,
      );
      const startedAt = Date.now();
      const response = await fetch(scrapeUrl.toString(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      console.log(
        `[linkMetadata] Cloudflare response received in ${Date.now() - startedAt}ms with status ${response.status}`,
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        let parsedError: CloudflareScrapeResponse | undefined;
        if (errorText) {
          try {
            parsedError = JSON.parse(errorText) as CloudflareScrapeResponse;
          } catch {
            // Ignore JSON parse issues; we'll fall back to the raw body.
          }
        }

        const primaryError = parsedError?.errors?.[0];
        const errorCode =
          typeof primaryError?.code === "number" ? primaryError.code : undefined;
        const errorMessage = primaryError?.message;
        const isRateLimit = response.status === 429 || errorCode === 2001;
        const isSessionIssue =
          errorCode === 2000 ||
          (errorMessage?.toLowerCase().includes("existing session") ?? false);

        console.error(
          `[linkMetadata] Cloudflare API error ${response.status} ${response.statusText} for ${normalizedUrl}:`,
          errorText || parsedError || "<empty>",
        );

        if (isRateLimit || response.status >= 500) {
          const retryType = isRateLimit
            ? "rate_limit"
            : isSessionIssue
              ? "session_error"
              : "http_error";
          throwRetryable({
            type: retryType,
            normalizedUrl,
            message:
              errorMessage ||
              `Cloudflare Browser Rendering returned ${response.status}`,
            details: parsedError?.errors ?? errorText?.slice(0, 2000),
          });
        }

        await ctx.runMutation(linkMetadataInternal.updateCardMetadata, {
          cardId,
          linkPreview: buildErrorPreview(normalizedUrl, {
            type: isRateLimit ? "rate_limit" : "http_error",
            message:
              errorMessage ||
              `Cloudflare Browser Rendering returned ${response.status}`,
            details:
              parsedError?.errors ??
              (errorText ? errorText.slice(0, 2000) : undefined),
          }),
          status: "failed",
        });

        return {
          status: "failed" as const,
          normalizedUrl,
          errorType: isRateLimit ? "rate_limit" : "http_error",
          errorMessage:
            errorMessage ||
            `Cloudflare Browser Rendering returned ${response.status}`,
        };
      }

      const payload: CloudflareScrapeResponse = await response.json();
      if (!payload.success) {
        console.warn(
          `[linkMetadata] Cloudflare scrape failed for ${normalizedUrl}`,
          payload.errors,
        );

        throwRetryable({
          type: "scrape_error",
          normalizedUrl,
          message:
            payload.errors
              ?.map((error) => error?.message)
              .filter(Boolean)
              .join("; ") || "Unknown scrape error",
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
