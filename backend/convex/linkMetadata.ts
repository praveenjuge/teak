import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

export interface CloudflareScrapeAttribute {
  name: string;
  value: string;
}

export interface CloudflareScrapeResultItem {
  text?: string;
  html?: string;
  attributes?: CloudflareScrapeAttribute[];
}

export interface CloudflareScrapeSelectorResult {
  selector: string;
  results: CloudflareScrapeResultItem[];
}

export interface CloudflareScrapeResponse {
  success: boolean;
  result?: CloudflareScrapeSelectorResult[];
  errors?: Array<{ code?: number; message?: string }>;
}

export interface LinkPreviewMetadata {
  source: "cloudflare_browser_rendering";
  status: "success" | "error";
  fetchedAt: number;
  url: string;
  finalUrl?: string;
  canonicalUrl?: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  faviconUrl?: string;
  siteName?: string;
  author?: string;
  publisher?: string;
  publishedAt?: string;
  screenshotStorageId?: Id<"_storage">;
  screenshotUpdatedAt?: number;
  error?: {
    type?: string;
    message?: string;
    details?: any;
  };
  raw?: CloudflareScrapeSelectorResult[];
}

export const normalizeUrl = (url: string): string => {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return `https://${url}`;
  }
  return url;
};


// Internal query to get card for metadata extraction
export const getCardForMetadata = internalQuery({
  args: { cardId: v.id("cards") },
  handler: async (ctx, { cardId }) => {
    return await ctx.db.get(cardId);
  },
});

// Internal mutation to update card with link metadata
export const updateCardMetadata = internalMutation({
  args: {
    cardId: v.id("cards"),
    linkPreview: v.optional(v.any()),
    status: v.union(v.literal("completed"), v.literal("failed")),
  },
  handler: async (ctx, { cardId, linkPreview, status }) => {
    const existingCard = await ctx.db.get(cardId);
    if (!existingCard) {
      console.error(`Card ${cardId} not found for metadata update`);
      return;
    }

    const previousLinkPreview = existingCard.metadata?.linkPreview;
    let nextLinkPreview = linkPreview ? { ...linkPreview } : undefined;

    if (previousLinkPreview?.screenshotStorageId) {
      if (
        nextLinkPreview?.screenshotStorageId &&
        nextLinkPreview.screenshotStorageId !== previousLinkPreview.screenshotStorageId
      ) {
        try {
          await ctx.storage.delete(previousLinkPreview.screenshotStorageId);
        } catch (error) {
          console.error(
            `[linkMetadata] Failed to delete previous screenshot ${previousLinkPreview.screenshotStorageId} for card ${cardId}:`,
            error
          );
        }
      } else if (nextLinkPreview && !nextLinkPreview.screenshotStorageId) {
        nextLinkPreview.screenshotStorageId = previousLinkPreview.screenshotStorageId;
        nextLinkPreview.screenshotUpdatedAt =
          nextLinkPreview.screenshotUpdatedAt ?? previousLinkPreview.screenshotUpdatedAt;
      }
    }

    // For link cards being updated, move to new linkPreview structure
    // For non-link cards, preserve existing metadata while layering the new field
    let updatedMetadata: Record<string, any> = {};

    const existingCategory = existingCard.metadata?.linkCategory;

    if (existingCard.type === "link") {
      updatedMetadata = {
        ...(nextLinkPreview ? { linkPreview: nextLinkPreview } : {}),
        ...(existingCategory ? { linkCategory: existingCategory } : {}),
      };
    } else {
      updatedMetadata = {
        ...existingCard.metadata,
        ...(nextLinkPreview !== undefined ? { linkPreview: nextLinkPreview } : {}),
        ...(existingCategory ? { linkCategory: existingCategory } : {}),
      };
    }

    // Prepare update fields
    const updateFields: any = {
      metadata: updatedMetadata,
      metadataStatus: status,
      updatedAt: Date.now(),
    };

    // Extract title and description for search indexes
    const title = nextLinkPreview?.title;
    const description = nextLinkPreview?.description;

    if (title) {
      updateFields.metadataTitle = title;
    }
    if (description) {
      updateFields.metadataDescription = description;
    }

    return await ctx.db.patch(cardId, updateFields);
  },
});

export const updateCardScreenshot = internalMutation({
  args: {
    cardId: v.id("cards"),
    screenshotStorageId: v.id("_storage"),
    screenshotUpdatedAt: v.number(),
  },
  handler: async (ctx, { cardId, screenshotStorageId, screenshotUpdatedAt }) => {
    const card = await ctx.db.get(cardId);
    if (!card || card.type !== "link") {
      return;
    }

    const existingMetadata = card.metadata || {};
    const existingLinkPreview = existingMetadata.linkPreview || {};

    if (
      existingLinkPreview.screenshotStorageId &&
      existingLinkPreview.screenshotStorageId !== screenshotStorageId
    ) {
      try {
        await ctx.storage.delete(existingLinkPreview.screenshotStorageId);
      } catch (error) {
        console.error(
          `[linkMetadata] Failed to delete previous screenshot ${existingLinkPreview.screenshotStorageId} for card ${cardId}:`,
          error
        );
      }
    }

    const updatedLinkPreview = {
      ...existingLinkPreview,
      screenshotStorageId,
      screenshotUpdatedAt,
    };

    const updatedMetadata = {
      ...existingMetadata,
      linkPreview: updatedLinkPreview,
    };

    await ctx.db.patch(cardId, {
      metadata: updatedMetadata,
      updatedAt: Date.now(),
    });
  },
});

export type SelectorSource = {
  selector: string;
  attribute: "content" | "href" | "text";
};

export const TITLE_SOURCES: SelectorSource[] = [
  { selector: "meta[property='og:title']", attribute: "content" },
  { selector: "meta[name='og:title']", attribute: "content" },
  { selector: "meta[name='twitter:title']", attribute: "content" },
  { selector: "meta[property='twitter:title']", attribute: "content" },
  { selector: "meta[name='title']", attribute: "content" },
  { selector: "head > title", attribute: "text" },
];

export const DESCRIPTION_SOURCES: SelectorSource[] = [
  { selector: "meta[property='og:description']", attribute: "content" },
  { selector: "meta[name='og:description']", attribute: "content" },
  { selector: "meta[name='description']", attribute: "content" },
  { selector: "meta[property='description']", attribute: "content" },
  { selector: "meta[name='twitter:description']", attribute: "content" },
  { selector: "meta[property='twitter:description']", attribute: "content" },
];

export const IMAGE_SOURCES: SelectorSource[] = [
  { selector: "meta[property='og:image:secure_url']", attribute: "content" },
  { selector: "meta[property='og:image:url']", attribute: "content" },
  { selector: "meta[property='og:image']", attribute: "content" },
  { selector: "meta[name='og:image']", attribute: "content" },
  { selector: "meta[property='twitter:image']", attribute: "content" },
  { selector: "meta[name='twitter:image']", attribute: "content" },
  { selector: "meta[property='twitter:image:src']", attribute: "content" },
  { selector: "meta[name='twitter:image:src']", attribute: "content" },
  { selector: "link[rel='image_src']", attribute: "href" },
  { selector: "meta[name='msapplication-TileImage']", attribute: "content" },
];

export const FAVICON_SOURCES: SelectorSource[] = [
  { selector: "link[rel='icon']", attribute: "href" },
  { selector: "link[rel='shortcut icon']", attribute: "href" },
  { selector: "link[rel='apple-touch-icon']", attribute: "href" },
  { selector: "link[rel='apple-touch-icon-precomposed']", attribute: "href" },
  { selector: "link[rel='mask-icon']", attribute: "href" },
];

export const SITE_NAME_SOURCES: SelectorSource[] = [
  { selector: "meta[property='og:site_name']", attribute: "content" },
  { selector: "meta[name='og:site_name']", attribute: "content" },
  { selector: "meta[name='application-name']", attribute: "content" },
  { selector: "meta[name='publisher']", attribute: "content" },
];

export const AUTHOR_SOURCES: SelectorSource[] = [
  { selector: "meta[name='author']", attribute: "content" },
  { selector: "meta[property='article:author']", attribute: "content" },
  { selector: "meta[name='byl']", attribute: "content" },
  { selector: "meta[property='book:author']", attribute: "content" },
];

export const PUBLISHER_SOURCES: SelectorSource[] = [
  { selector: "meta[property='article:publisher']", attribute: "content" },
  { selector: "meta[name='publisher']", attribute: "content" },
  { selector: "meta[property='og:site_name']", attribute: "content" },
];

export const PUBLISHED_TIME_SOURCES: SelectorSource[] = [
  { selector: "meta[property='article:published_time']", attribute: "content" },
  { selector: "meta[name='article:published_time']", attribute: "content" },
  { selector: "meta[name='pubdate']", attribute: "content" },
  { selector: "meta[name='publication_date']", attribute: "content" },
  { selector: "meta[name='date']", attribute: "content" },
];

export const CANONICAL_SOURCES: SelectorSource[] = [
  { selector: "link[rel='canonical']", attribute: "href" },
  { selector: "meta[property='og:url']", attribute: "content" },
  { selector: "meta[name='og:url']", attribute: "content" },
];

export const FINAL_URL_SOURCES: SelectorSource[] = [
  { selector: "meta[property='og:url']", attribute: "content" },
  { selector: "meta[name='og:url']", attribute: "content" },
  { selector: "meta[property='al:web:url']", attribute: "content" },
  { selector: "meta[property='twitter:url']", attribute: "content" },
  { selector: "meta[name='twitter:url']", attribute: "content" },
];

export const GITHUB_SOURCES: SelectorSource[] = [
  { selector: "a[href$='/stargazers']", attribute: "text" },
  { selector: "a[href$='/network/members']", attribute: "text" },
  { selector: "a[href$='/watchers']", attribute: "text" },
  { selector: "span[itemprop='programmingLanguage']", attribute: "text" },
  { selector: "relative-time", attribute: "text" },
];

export const GOODREADS_SOURCES: SelectorSource[] = [
  { selector: "meta[property='books:rating:average']", attribute: "content" },
  { selector: "meta[property='books:rating:count']", attribute: "content" },
  { selector: "meta[property='books:isbn']", attribute: "content" },
];

export const AMAZON_SOURCES: SelectorSource[] = [
  { selector: "meta[property='og:price:amount']", attribute: "content" },
  { selector: "meta[property='og:price:currency']", attribute: "content" },
  { selector: "meta[name='price']", attribute: "content" },
  { selector: "#priceblock_ourprice", attribute: "text" },
  { selector: "#priceblock_dealprice", attribute: "text" },
  { selector: ".a-price .a-offscreen", attribute: "text" },
];

export const IMDB_SOURCES: SelectorSource[] = [
  { selector: "meta[name='imdb:rating']", attribute: "content" },
  { selector: "meta[name='imdb:votes']", attribute: "content" },
  { selector: "meta[property='video:release_date']", attribute: "content" },
  { selector: "span[data-testid='hero-rating-bar__aggregate-rating__score']", attribute: "text" },
  { selector: "span[data-testid='title-techspec_runtime'] span", attribute: "text" },
];

export const SCRAPE_ELEMENTS = Array.from(
  new Map(
    [
      ...TITLE_SOURCES,
      ...DESCRIPTION_SOURCES,
      ...IMAGE_SOURCES,
      ...FAVICON_SOURCES,
      ...SITE_NAME_SOURCES,
      ...AUTHOR_SOURCES,
      ...PUBLISHER_SOURCES,
      ...PUBLISHED_TIME_SOURCES,
      ...CANONICAL_SOURCES,
      ...FINAL_URL_SOURCES,
      ...GITHUB_SOURCES,
      ...GOODREADS_SOURCES,
      ...AMAZON_SOURCES,
      ...IMDB_SOURCES,
    ].map((source) => [source.selector, { selector: source.selector }])
  ).values()
);

export const toSelectorMap = (
  results?: CloudflareScrapeSelectorResult[]
): Map<string, CloudflareScrapeResultItem[]> => {
  const map = new Map<string, CloudflareScrapeResultItem[]>();
  if (!results) {
    return map;
  }
  for (const entry of results) {
    map.set(entry.selector, entry.results ?? []);
  }
  return map;
};

export const findAttributeValue = (
  item: CloudflareScrapeResultItem | undefined,
  attribute: string
): string | undefined => {
  if (!item?.attributes) {
    return undefined;
  }
  const needle = attribute.toLowerCase();
  const match = item.attributes.find((attr) => attr.name?.toLowerCase() === needle);
  return match?.value?.trim() || undefined;
};

export const getSelectorValue = (
  map: Map<string, CloudflareScrapeResultItem[]>,
  source: SelectorSource
): string | undefined => {
  const candidates = map.get(source.selector) ?? [];
  const primary =
    candidates.find((item) => {
      if (source.attribute === "text") {
        const value = item.text?.trim() || item.html?.trim();
        return Boolean(value);
      }
      const attrValue = findAttributeValue(item, source.attribute);
      return Boolean(attrValue);
    }) ?? candidates[0];

  if (!primary) {
    return undefined;
  }

  if (source.attribute === "text") {
    return primary.text?.trim() || primary.html?.trim() || undefined;
  }

  return findAttributeValue(primary, source.attribute);
};

export const firstFromSources = (
  map: Map<string, CloudflareScrapeResultItem[]>,
  sources: SelectorSource[]
): string | undefined => {
  for (const source of sources) {
    const value = getSelectorValue(map, source);
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

export const sanitizeText = (value: string | undefined, maxLength: number): string | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length > maxLength) {
    return normalized.slice(0, maxLength);
  }
  return normalized;
};

export const sanitizeUrl = (
  baseUrl: string,
  value: string | undefined,
  { allowData }: { allowData?: boolean } = {}
): string | undefined => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^data:/i.test(trimmed)) {
    return allowData ? trimmed : undefined;
  }

  if (/^(javascript:|mailto:)/i.test(trimmed)) {
    return undefined;
  }

  try {
    const resolved = new URL(trimmed, baseUrl);
    if (!/^https?:/i.test(resolved.protocol)) {
      return undefined;
    }
    return resolved.toString();
  } catch {
    return undefined;
  }
};

export const sanitizeImageUrl = (baseUrl: string, value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (/^data:/i.test(trimmed)) {
    return trimmed;
  }
  return sanitizeUrl(baseUrl, trimmed, { allowData: true });
};

export const buildDebugRaw = (
  results?: CloudflareScrapeSelectorResult[]
): CloudflareScrapeSelectorResult[] | undefined => {
  if (!results) {
    return undefined;
  }
  return results.map((entry) => ({
    selector: entry.selector,
    results: (entry.results ?? []).slice(0, 1).map((item) => ({
      text: item.text,
      attributes: item.attributes,
    })),
  }));
};

export const parseLinkPreview = (
  normalizedUrl: string,
  results?: CloudflareScrapeSelectorResult[]
) => {
  const selectorMap = toSelectorMap(results);

  const title = sanitizeText(firstFromSources(selectorMap, TITLE_SOURCES), 512);
  const description = sanitizeText(firstFromSources(selectorMap, DESCRIPTION_SOURCES), 2048);
  const imageUrl = sanitizeImageUrl(normalizedUrl, firstFromSources(selectorMap, IMAGE_SOURCES));
  const faviconUrl = sanitizeUrl(normalizedUrl, firstFromSources(selectorMap, FAVICON_SOURCES));
  const siteName = sanitizeText(firstFromSources(selectorMap, SITE_NAME_SOURCES), 256);
  const author = sanitizeText(firstFromSources(selectorMap, AUTHOR_SOURCES), 256);
  const publisher = sanitizeText(firstFromSources(selectorMap, PUBLISHER_SOURCES), 256);
  const publishedAtRaw = firstFromSources(selectorMap, PUBLISHED_TIME_SOURCES);
  const publishedAt = publishedAtRaw
    ? publishedAtRaw.trim().slice(0, 128)
    : undefined;
  const canonicalUrl = sanitizeUrl(normalizedUrl, firstFromSources(selectorMap, CANONICAL_SOURCES));
  const finalUrlCandidate = sanitizeUrl(normalizedUrl, firstFromSources(selectorMap, FINAL_URL_SOURCES));

  return {
    title,
    description,
    imageUrl,
    faviconUrl,
    siteName,
    author,
    publisher,
    publishedAt,
    canonicalUrl,
    finalUrl: finalUrlCandidate ?? canonicalUrl ?? normalizedUrl,
    raw: buildDebugRaw(results),
  };
};

export const buildSuccessPreview = (
  url: string,
  parsed: ReturnType<typeof parseLinkPreview>
): LinkPreviewMetadata => ({
  source: "cloudflare_browser_rendering",
  status: "success",
  fetchedAt: Date.now(),
  url,
  ...parsed,
});

export const buildErrorPreview = (
  url: string,
  error: {
    type: string;
    message?: string;
    details?: any;
  },
  extras?: {
    screenshotStorageId?: Id<"_storage">;
    screenshotUpdatedAt?: number;
  }
): LinkPreviewMetadata => ({
  source: "cloudflare_browser_rendering",
  status: "error",
  fetchedAt: Date.now(),
  url,
  finalUrl: url,
  ...(extras?.screenshotStorageId
    ? {
      screenshotStorageId: extras.screenshotStorageId,
      screenshotUpdatedAt: extras.screenshotUpdatedAt,
    }
    : {}),
  error,
});

const captureScreenshot = async (
  ctx: any,
  {
    accountId,
    apiToken,
    url,
  }: { accountId: string; apiToken: string; url: string }
): Promise<{
  screenshotId?: Id<"_storage">;
  screenshotUpdatedAt?: number;
  error?: { type: string; message?: string; details?: any };
}> => {
  try {
    const screenshotEndpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/screenshot`;
    const controller = new AbortController();
    const timeoutMs = 30000;
    const timeoutId = setTimeout(() => {
      console.warn(`[linkMetadata] Screenshot request timeout after ${timeoutMs}ms for ${url}`);
      controller.abort();
    }, timeoutMs);

    const requestBody = {
      url,
      gotoOptions: {
        waitUntil: "networkidle0",
        timeout: 30000,
      },
      viewport: {
        width: 1280,
        height: 720,
      },
      screenshotOptions: {
        type: "jpeg",
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
          responseDetails = JSON.stringify(errorJson)?.slice(0, 2000);
        } catch (jsonError) {
          console.error(`[linkMetadata] Failed to parse screenshot error JSON for ${url}:`, jsonError);
        }
      } else {
        responseDetails = await response.text().catch(() => "<unavailable>");
      }

      console.error(
        `[linkMetadata] Screenshot HTTP error ${response.status} ${response.statusText} for ${url}:`,
        responseDetails
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
        console.warn(`[linkMetadata] Screenshot payload indicated failure for ${url}`, payload?.errors);
        return {
          error: {
            type: "api_error",
            message:
              payload?.errors?.map((error: any) => error?.message).filter(Boolean).join("; ") ||
              "Screenshot capture failed",
            details: payload?.errors,
          },
        };
      }

      const base64Screenshot: string | undefined =
        payload?.result?.screenshot || payload?.result?.image || payload?.result?.png;
      if (!base64Screenshot) {
        console.warn(`[linkMetadata] Screenshot payload missing screenshot data for ${url}`);
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
        buffer.byteOffset + buffer.byteLength
      );
      mimeType = payload?.result?.type || mimeType;
    } else {
      imageArrayBuffer = await response.arrayBuffer();
      if (contentType) {
        mimeType = contentType.split(";")[0];
      }
    }

    if (!imageArrayBuffer) {
      console.warn(`[linkMetadata] Screenshot response did not include image data for ${url}`);
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
    console.error(`[linkMetadata] Screenshot capture error for ${url}:`, error);
    let type = "error";
    if ((error as any)?.name === "AbortError") {
      type = "timeout";
    } else if ((error as any)?.name === "TypeError" && (error as any)?.message?.includes("fetch")) {
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

const SCREENSHOT_RATE_LIMIT_MAX_RETRIES = 3;
const SCREENSHOT_RETRY_DELAY_MS = 15000;
const SCREENSHOT_HTTP_RETRY_DELAY_MS = 5000;

export const generateLinkScreenshot = internalAction({
  args: {
    cardId: v.id("cards"),
    retryCount: v.optional(v.number()),
  },
  handler: async (ctx, { cardId, retryCount = 0 }) => {
    const card = await ctx.runQuery(internal.linkMetadata.getCardForMetadata, { cardId });

    if (!card || card.type !== "link" || !card.url) {
      return;
    }

    const linkPreview = card.metadata?.linkPreview;
    if (!linkPreview || linkPreview.status !== "success") {
      console.log(
        `[linkMetadata] Skipping screenshot for card ${cardId} because link preview metadata is not ready`
      );
      return;
    }

    if (linkPreview.screenshotStorageId && retryCount === 0) {
      // Screenshot already exists; nothing to do
      return;
    }

    const accountId = process.env.CLOUDFLARE_BROWSER_RENDERING_ACCOUNT_ID;
    const apiToken =
      process.env.CLOUDFLARE_BROWSER_RENDERING_API_TOKEN ||
      process.env.CLOUDFLARE_API_TOKEN ||
      process.env.CLOUDFLARE_API_KEY;

    if (!accountId || !apiToken) {
      console.error(`[linkMetadata] Missing Cloudflare credentials for screenshot of card ${cardId}`);
      return;
    }

    const normalizedUrl = normalizeUrl(card.url);
    const screenshotResult = await captureScreenshot(ctx, {
      accountId,
      apiToken,
      url: normalizedUrl,
    });

    if (screenshotResult?.screenshotId) {
      await ctx.runMutation(internal.linkMetadata.updateCardScreenshot, {
        cardId,
        screenshotStorageId: screenshotResult.screenshotId,
        screenshotUpdatedAt: screenshotResult.screenshotUpdatedAt ?? Date.now(),
      });
      console.log(`[linkMetadata] Stored screenshot for card ${cardId}`);
      return;
    }

    if (!screenshotResult?.error) {
      return;
    }

    const { type } = screenshotResult.error;
    const nextRetryCount = retryCount + 1;

    if (type === "rate_limit" && retryCount < SCREENSHOT_RATE_LIMIT_MAX_RETRIES) {
      console.warn(
        `[linkMetadata] Screenshot rate limited for card ${cardId}, retry ${nextRetryCount} in ${SCREENSHOT_RETRY_DELAY_MS}ms`
      );
      await ctx.scheduler.runAfter(SCREENSHOT_RETRY_DELAY_MS, internal.linkMetadata.generateLinkScreenshot, {
        cardId,
        retryCount: nextRetryCount,
      });
      return;
    }

    if (type === "http_error" && retryCount < 1) {
      console.warn(
        `[linkMetadata] Screenshot HTTP error for card ${cardId}, retry ${nextRetryCount} in ${SCREENSHOT_HTTP_RETRY_DELAY_MS}ms`
      );
      await ctx.scheduler.runAfter(SCREENSHOT_HTTP_RETRY_DELAY_MS, internal.linkMetadata.generateLinkScreenshot, {
        cardId,
        retryCount: nextRetryCount,
      });
      return;
    }

    console.warn(`[linkMetadata] Screenshot capture failed for card ${cardId} after ${retryCount + 1} attempt(s):`, screenshotResult.error);
  },
});
