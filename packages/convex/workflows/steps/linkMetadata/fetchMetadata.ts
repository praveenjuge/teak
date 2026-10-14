"use node";

import { lookup } from "node:dns/promises";
import { gzipSync } from "node:zlib";
import type { FilesScrapeResult } from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { internalAction } from "../../../_generated/server";
import type {
  LinkPreviewMediaItem,
  ScrapeAttribute,
  ScrapeResponse,
  ScrapeResultItem,
  ScrapeSelectorResult,
} from "../../../linkMetadata";
import {
  buildErrorPreview,
  buildSuccessPreview,
  extractInstagramMediaFromHtml,
  isInstagramPostUrl,
  normalizeUrl,
  parseLinkPreview,
  SCRAPE_ELEMENTS,
} from "../../../linkMetadata";
import type { InstagramPostMedia } from "../../../linkMetadata/instagram";
import {
  assertUrlIsSafe,
  type DnsResolver,
  readBodyWithLimit,
  SsrfError,
  safeFetch,
} from "../../../linkMetadata/ssrf";
import {
  fetchXStatusMetadata,
  isXStatusUrl,
  type XStatusMedia,
} from "../../../linkMetadata/x";
import { TELEMETRY_OPERATIONS } from "../../../shared/telemetry";
import { runFilesWorkerRendering } from "../../../storage/filesWorkerRendering";
import { buildR2ObjectKey, storeObject } from "../../../storage/r2";
import { withBackendErrorCapture } from "../../../telemetry/posthog";
import { pinnedFetch } from "../pinnedFetch";
import { readRemoteImageDimensions } from "./remoteImageDimensions";
import {
  LINK_METADATA_RETRYABLE_PREFIX,
  type LinkMetadataRetryableError,
} from "./retryable";

// Resolves hostnames via the Node runtime DNS. Injected into the SSRF guard so
// that the guard itself stays free of Node built-ins (and bundles for any
// Convex runtime).
const resolveDns: DnsResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

// Top-level regex patterns for performance
const IMAGE_EXTENSION_REGEX = /\.(png|jpe?g|webp|gif|avif|svg)(?:[?#]|$)/;
const VIDEO_EXTENSION_REGEX = /\.(mp4|mov|m4v)(?:[?#]|$)/;
const TITLE_TAG_REGEX = /<title[^>]*>([\s\S]*?)<\/title>/i;
const META_SELECTOR_REGEX = /^meta\[(property|name)=['"]([^'"]+)['"]\]$/i;
const LINK_SELECTOR_REGEX = /^link\[rel=['"]([^'"]+)['"]\]$/i;
const MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_REMOTE_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_REMOTE_HTML_BYTES = 2 * 1024 * 1024;

type PersistableLinkMedia = XStatusMedia | InstagramPostMedia;

// Re-exported for backwards compatibility; the source of truth lives in
// ./retryable so default-runtime workflow files can import it without dragging
// this "use node" module into the isolate bundle.
export {
  LINK_METADATA_RETRYABLE_PREFIX,
  type LinkMetadataRetryableError,
} from "./retryable";

const internalFunctions = internal as Record<string, any>;
const linkMetadataInternal = internalFunctions.linkMetadata as Record<
  string,
  any
>;

const throwRetryable = (info: LinkMetadataRetryableError): never => {
  throw new Error(`${LINK_METADATA_RETRYABLE_PREFIX}${JSON.stringify(info)}`);
};

interface StoredLinkImage {
  imageHeight: number;
  imageStorageKey: string;
  imageUpdatedAt: number;
  imageWidth: number;
}

interface StoredRemoteAsset {
  bytes: Uint8Array;
  contentType: string;
  storageKey: string;
  updatedAt: number;
}

const guessImageContentType = (imageUrl: string): string | null => {
  const match = imageUrl.toLowerCase().match(IMAGE_EXTENSION_REGEX);
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

const guessVideoContentType = (assetUrl: string): string | null => {
  const match = assetUrl.toLowerCase().match(VIDEO_EXTENSION_REGEX);
  if (!match) {
    return null;
  }
  switch (match[1]) {
    case "mp4":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "m4v":
      return "video/x-m4v";
    default:
      return null;
  }
};

const resolveImageContentType = (
  headerValue: string | null,
  imageUrl: string
): string | null => {
  if (headerValue?.toLowerCase().startsWith("image/")) {
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

const resolveAssetContentType = (
  headerValue: string | null,
  assetUrl: string,
  fallbackContentType?: string
): string | null => {
  const normalizedHeader = headerValue?.split(";")[0]?.trim();
  if (normalizedHeader) {
    return normalizedHeader;
  }

  if (fallbackContentType) {
    return fallbackContentType;
  }

  return guessImageContentType(assetUrl) ?? guessVideoContentType(assetUrl);
};

const hasAllowedContentType = (
  contentType: string,
  allowedPrefixes: readonly string[]
): boolean => allowedPrefixes.some((prefix) => contentType.startsWith(prefix));

const storeRemoteAsset = async (
  ctx: any,
  assetUrl: string,
  {
    allowedContentTypePrefixes,
    fallbackContentType,
    key,
    userId,
    maxBytes,
    validateBytes,
  }: {
    allowedContentTypePrefixes: readonly string[];
    fallbackContentType?: string;
    key: string;
    userId: string;
    maxBytes: number;
    validateBytes?: (bytes: Uint8Array) => boolean;
  }
): Promise<StoredRemoteAsset | null> => {
  try {
    const response = await safeFetch(assetUrl, resolveDns, {}, pinnedFetch);
    if (!response.ok) {
      console.warn(
        `[linkMetadata] Remote asset fetch failed (${response.status}) for ${assetUrl}`
      );
      return null;
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        console.warn(
          `[linkMetadata] Remote asset skipped due to size (${contentLength}) for ${assetUrl}`
        );
        return null;
      }
    }

    const contentType = resolveAssetContentType(
      response.headers.get("content-type"),
      assetUrl,
      fallbackContentType
    );
    if (
      !(
        contentType &&
        hasAllowedContentType(contentType, allowedContentTypePrefixes)
      )
    ) {
      console.warn(
        `[linkMetadata] Remote asset skipped due to unsupported content type for ${assetUrl}`
      );
      return null;
    }

    const bytes = await readBodyWithLimit(response, maxBytes);
    if (!bytes.byteLength) {
      console.warn(
        `[linkMetadata] Remote asset skipped because it is empty for ${assetUrl}`
      );
      return null;
    }

    if (validateBytes && !validateBytes(bytes)) {
      console.warn(
        `[linkMetadata] Remote asset skipped because validation failed for ${assetUrl}`
      );
      return null;
    }

    const storageKey = await storeObject(
      ctx,
      new Blob([Uint8Array.from(bytes)]),
      {
        key,
        userId,
        type: contentType,
      }
    );

    return {
      bytes,
      contentType,
      storageKey,
      updatedAt: Date.now(),
    };
  } catch (error) {
    console.warn("[linkMetadata] Remote asset fetch error", error);
    return null;
  }
};

const storeLinkPreviewImage = async (
  ctx: any,
  imageUrl: string,
  keyBase: { cardId: string; userId: string }
): Promise<StoredLinkImage | null> => {
  const storedAsset = await storeRemoteAsset(ctx, imageUrl, {
    userId: keyBase.userId,
    allowedContentTypePrefixes: ["image/"],
    fallbackContentType: resolveImageContentType(null, imageUrl) ?? undefined,
    key: buildR2ObjectKey({ ...keyBase, role: "link-preview-image" }),
    maxBytes: MAX_REMOTE_IMAGE_BYTES,
    validateBytes: (bytes) => readRemoteImageDimensions(bytes) !== null,
  });

  if (!storedAsset) {
    return null;
  }

  const dimensions = readRemoteImageDimensions(storedAsset.bytes);
  if (!dimensions) {
    return null;
  }

  return {
    imageStorageKey: storedAsset.storageKey,
    imageUpdatedAt: storedAsset.updatedAt,
    imageWidth: dimensions.width,
    imageHeight: dimensions.height,
  };
};

const storeLinkPreviewMediaItem = async (
  ctx: any,
  media: PersistableLinkMedia,
  keyBase: { cardId: string; userId: string }
): Promise<LinkPreviewMediaItem | null> => {
  const storedMedia = await storeRemoteAsset(ctx, media.url, {
    userId: keyBase.userId,
    allowedContentTypePrefixes:
      media.type === "image" ? ["image/"] : ["video/"],
    fallbackContentType: media.contentType,
    key: buildR2ObjectKey({ ...keyBase, role: `link-media-${media.type}` }),
    maxBytes:
      media.type === "image" ? MAX_REMOTE_IMAGE_BYTES : MAX_REMOTE_VIDEO_BYTES,
    validateBytes:
      media.type === "image"
        ? (bytes) => readRemoteImageDimensions(bytes) !== null
        : undefined,
  });

  if (!storedMedia) {
    return null;
  }

  let posterStorageKey: string | undefined;
  let posterUpdatedAt: number | undefined;
  let posterContentType: string | undefined;
  let posterWidth = media.posterWidth;
  let posterHeight = media.posterHeight;

  if (media.type === "video" && media.posterUrl) {
    const storedPoster = await storeRemoteAsset(ctx, media.posterUrl, {
      userId: keyBase.userId,
      allowedContentTypePrefixes: ["image/"],
      fallbackContentType: media.posterContentType,
      key: buildR2ObjectKey({ ...keyBase, role: "link-media-poster" }),
      maxBytes: MAX_REMOTE_IMAGE_BYTES,
      validateBytes: (bytes) => readRemoteImageDimensions(bytes) !== null,
    });

    if (storedPoster) {
      const posterDimensions = readRemoteImageDimensions(storedPoster.bytes);
      posterStorageKey = storedPoster.storageKey;
      posterUpdatedAt = storedPoster.updatedAt;
      posterContentType = storedPoster.contentType;
      posterWidth = posterDimensions?.width ?? posterWidth;
      posterHeight = posterDimensions?.height ?? posterHeight;
    }
  }

  return {
    type: media.type,
    storageKey: storedMedia.storageKey,
    updatedAt: storedMedia.updatedAt,
    contentType: storedMedia.contentType,
    width: media.width,
    height: media.height,
    ...(posterStorageKey
      ? {
          posterStorageKey,
          posterUpdatedAt,
          posterContentType,
          posterWidth,
          posterHeight,
        }
      : {}),
  };
};

const storeLinkPreviewMedia = async (
  ctx: any,
  media: PersistableLinkMedia[] | undefined,
  keyBase: { cardId: string; userId: string }
): Promise<LinkPreviewMediaItem[] | undefined> => {
  if (!media?.length) {
    return;
  }

  const storedMedia = await Promise.all(
    media.map((item) => storeLinkPreviewMediaItem(ctx, item, keyBase))
  );
  const persistedMedia = storedMedia.filter(
    (item): item is LinkPreviewMediaItem => Boolean(item)
  );
  return persistedMedia.length ? persistedMedia : undefined;
};

const decodeHtmlEntities = (value: string): string => {
  // Decode &amp; LAST to prevent double-unescaping vulnerabilities
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);/g, (_, num) =>
      String.fromCharCode(Number.parseInt(num, 10))
    )
    .replace(/&amp;/gi, "&");
};

const extractTagAttributes = (tag: string): ScrapeAttribute[] => {
  const attributes: ScrapeAttribute[] = [];
  const regex = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null = regex.exec(tag);
  while (match !== null) {
    const name = match[1];
    const rawValue = match[2] ?? match[3] ?? match[4] ?? "";
    attributes.push({
      name,
      value: decodeHtmlEntities(rawValue),
    });
    match = regex.exec(tag);
  }
  return attributes;
};

const buildSelectorResultsFromHtml = (
  html: string,
  selectors: { selector: string }[]
): ScrapeSelectorResult[] => {
  const metaTags: ScrapeResultItem[] = [];
  const linkTags: ScrapeResultItem[] = [];

  const metaRegex = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null = metaRegex.exec(html);
  while (match !== null) {
    const attributes = extractTagAttributes(match[0]);
    if (attributes.length) {
      metaTags.push({ attributes });
    }
    match = metaRegex.exec(html);
  }

  const linkRegex = /<link\b[^>]*>/gi;
  match = linkRegex.exec(html);
  while (match !== null) {
    const attributes = extractTagAttributes(match[0]);
    if (attributes.length) {
      linkTags.push({ attributes });
    }
    match = linkRegex.exec(html);
  }

  const titleMatch = html.match(TITLE_TAG_REGEX);
  const titleText = titleMatch
    ? decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, " ").trim()
    : undefined;

  return selectors.map(({ selector }) => {
    const normalizedSelector = selector.trim();
    const metaMatch = normalizedSelector.match(META_SELECTOR_REGEX);
    if (metaMatch) {
      const attrName = metaMatch[1].toLowerCase();
      const expectedValue = metaMatch[2].toLowerCase();
      const results = metaTags.filter((item) => {
        const attributes = item.attributes ?? [];
        const matchAttr = attributes.find(
          (attr) => attr.name.toLowerCase() === attrName
        );
        return matchAttr?.value?.toLowerCase() === expectedValue;
      });
      return { selector: normalizedSelector, results };
    }

    const linkMatch = normalizedSelector.match(LINK_SELECTOR_REGEX);
    if (linkMatch) {
      const expectedValue = linkMatch[1].toLowerCase();
      const results = linkTags.filter((item) => {
        const attributes = item.attributes ?? [];
        const matchAttr = attributes.find(
          (attr) => attr.name.toLowerCase() === "rel"
        );
        return matchAttr?.value?.trim().toLowerCase() === expectedValue;
      });
      return { selector: normalizedSelector, results };
    }

    if (normalizedSelector.toLowerCase() === "head > title") {
      return {
        selector: normalizedSelector,
        results: titleText ? [{ text: titleText }] : [],
      };
    }

    return { selector: normalizedSelector, results: [] };
  });
};

/** The page's static metadata, and its HTML for the browser and parsers. */
const scrapeWithFetch = async (
  url: string,
  selectors: { selector: string }[]
): Promise<{ html: string | null; payload: ScrapeResponse }> => {
  try {
    const response = await safeFetch(
      url,
      resolveDns,
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml",
        },
      },
      pinnedFetch
    );

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return {
        html: null,
        payload: {
          success: false,
          errors: [
            { code: response.status, message: `HTTP ${response.status}` },
          ],
        },
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      await response.body?.cancel().catch(() => undefined);
      return {
        html: null,
        payload: {
          success: false,
          errors: [{ message: `Unsupported content-type: ${contentType}` }],
        },
      };
    }

    const html = new TextDecoder().decode(
      await readBodyWithLimit(response, MAX_REMOTE_HTML_BYTES)
    );
    return {
      html,
      payload: {
        success: true,
        result: { selectors: buildSelectorResultsFromHtml(html, selectors) },
      },
    };
  } catch (error) {
    return {
      html: null,
      payload: {
        success: false,
        errors: [{ message: (error as Error)?.message || "fetch_failed" }],
      },
    };
  }
};

// HTTP statuses that will not change on retry: the page is gone, forbidden,
// or the request is malformed. Timeouts (408), too-early (425) and rate limits
// (429) stay retryable alongside 5xx and network errors.
const RETRYABLE_CLIENT_STATUSES = new Set([408, 425, 429]);

export const isDefinitiveHttpClientError = (status: number | undefined) =>
  typeof status === "number" &&
  status >= 400 &&
  status < 500 &&
  !RETRYABLE_CLIENT_STATUSES.has(status);

const scrapeHttpStatus = (payload: ScrapeResponse): number | undefined =>
  payload.errors?.find((error) => typeof error?.code === "number")?.code;

const hasSelectorResults = (payload: ScrapeResponse) =>
  payload.success &&
  payload.result?.selectors?.some((selector) => selector.results.length);

/**
 * Query the selectors on Browser Run, with the page's inline scripts run
 * offline, for pages whose static HTML has no preview metadata. Null keeps
 * the static result: the Worker declined or is unavailable.
 */
const scrapeWithBrowser = async (
  html: string,
  selectors: { selector: string }[]
): Promise<ScrapeResponse | null> => {
  try {
    const outcome = await runFilesWorkerRendering<FilesScrapeResult>(
      "scrape-html",
      {
        htmlGzipBase64: gzipSync(Buffer.from(html, "utf8")).toString("base64"),
        selectors: selectors.map((selector) => selector.selector),
      }
    );
    if (outcome.kind === "ok") {
      return { success: true, result: { selectors: outcome.data.selectors } };
    }
    console.log(`[linkMetadata] Browser scrape declined: ${outcome.reason}`);
  } catch (error) {
    console.warn("[linkMetadata] Browser scrape failed; keeping static HTML", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return null;
};

export const fetchMetadataHandler = async (ctx: any, { cardId }: any) => {
  const card = await ctx.runQuery(linkMetadataInternal.getCardForLinkFetch, {
    cardId,
  });

  if (!card?.url) {
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
    classificationStatus === "pending" ||
    classificationStatus === "in_progress" ||
    (!classificationStatus &&
      card.metadata?.linkCategory?.status === "pending");

  if (classificationPending) {
    throwRetryable({
      type: "awaiting_classification",
      normalizedUrl: card.url,
      message: "Waiting for classification to finish",
    });
  }

  if (card.type !== "link") {
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
  const keyBase = { cardId, userId: card.userId };

  // Kill switch from the superadmin console. The card keeps a failed preview
  // naming the pause; refreshing it from the console fetches it again.
  if (
    (await ctx.runQuery(internal.adminAccess.isLinkFetchPaused, {})) === true
  ) {
    const message = "Link fetching is paused";
    await ctx.runMutation(linkMetadataInternal.updateCardMetadata, {
      cardId,
      linkPreview: buildErrorPreview(normalizedUrl, {
        type: "fetching_paused",
        message,
      }),
      status: "failed",
    });
    return {
      status: "failed" as const,
      normalizedUrl,
      errorType: "fetching_paused",
      errorMessage: message,
    };
  }

  // SSRF guard: validate the destination before any server-side fetch or
  // headless-browser navigation. A blocked URL is a permanent failure, not a
  // retryable transient error.
  try {
    await assertUrlIsSafe(normalizedUrl, resolveDns);
  } catch (error) {
    if (error instanceof SsrfError) {
      await ctx.runMutation(linkMetadataInternal.updateCardMetadata, {
        cardId,
        linkPreview: buildErrorPreview(normalizedUrl, {
          type: "blocked_url",
          message: "URL points to a disallowed destination",
        }),
        status: "failed",
      });
      return {
        status: "failed" as const,
        normalizedUrl,
        errorType: "blocked_url",
        errorMessage: "URL points to a disallowed destination",
      };
    }
    throw error;
  }

  try {
    if (isXStatusUrl(normalizedUrl)) {
      const xStatusMetadata = await fetchXStatusMetadata(normalizedUrl);

      if (xStatusMetadata) {
        const storedMedia = await storeLinkPreviewMedia(
          ctx,
          xStatusMetadata.media,
          keyBase
        );
        const linkPreview = buildSuccessPreview(normalizedUrl, {
          ...xStatusMetadata,
          media: storedMedia,
        });

        await ctx.runMutation(linkMetadataInternal.updateCardMetadata, {
          cardId,
          linkPreview,
          status: "completed",
        });

        return {
          status: "success" as const,
          normalizedUrl,
          linkPreview,
        };
      }
    }

    const { html, payload: staticPayload } = await scrapeWithFetch(
      normalizedUrl,
      SCRAPE_ELEMENTS
    );
    let payload = staticPayload;

    // A dead or forbidden link (404, 410, 401, 403, ...) will not recover on
    // retry, so store a failed preview instead of rerunning the browser scrape.
    const staticStatus = staticPayload.success
      ? undefined
      : scrapeHttpStatus(staticPayload);
    if (isDefinitiveHttpClientError(staticStatus)) {
      const errorMessage = `HTTP ${staticStatus}`;
      await ctx.runMutation(linkMetadataInternal.updateCardMetadata, {
        cardId,
        linkPreview: buildErrorPreview(normalizedUrl, {
          type: "http_error",
          message: errorMessage,
          details: { status: staticStatus },
        }),
        status: "failed",
      });
      return {
        status: "failed" as const,
        normalizedUrl,
        errorType: "http_error",
        errorMessage,
      };
    }

    if (!staticPayload.success) {
      const errorMessage =
        staticPayload.errors
          ?.map((error) => error?.message)
          .filter(Boolean)
          .join("; ") || "Unknown scrape error";
      throwRetryable({
        type:
          scrapeHttpStatus(staticPayload) === 429
            ? "rate_limit"
            : "scrape_error",
        normalizedUrl,
        message: errorMessage,
        details: { fallback: staticPayload.errors },
      });
    }

    // Most pages expose their preview metadata in static HTML. Pages without
    // it get the same HTML rendered offline, so inline scripts can fill it in.
    if (html && !hasSelectorResults(payload)) {
      payload = (await scrapeWithBrowser(html, SCRAPE_ELEMENTS)) ?? payload;
    }

    const parsed = parseLinkPreview(normalizedUrl, payload.result?.selectors);
    // Instagram posts embed their media in the page's relay JSON; og:image
    // stays the fallback when it is missing (a login wall).
    const extractedInstagramMedia =
      html && isInstagramPostUrl(normalizedUrl)
        ? extractInstagramMediaFromHtml(normalizedUrl, html)
        : undefined;
    const storedInstagramMedia = extractedInstagramMedia?.length
      ? await storeLinkPreviewMedia(ctx, extractedInstagramMedia, keyBase)
      : undefined;
    const attachedPreviewImageUrl =
      extractedInstagramMedia?.find((item) => item.type === "image")?.url ??
      extractedInstagramMedia?.find((item) => item.type === "video")?.posterUrl;
    const hasStoredAttachedPreview = Boolean(
      storedInstagramMedia?.some(
        (item) =>
          item.type === "image" ||
          (item.type === "video" && Boolean(item.posterStorageKey))
      )
    );
    const resolvedImageUrl = attachedPreviewImageUrl ?? parsed.imageUrl;
    const parsedWithPrimary = resolvedImageUrl
      ? { ...parsed, imageUrl: resolvedImageUrl }
      : parsed;
    const shouldStorePreviewImage =
      Boolean(resolvedImageUrl) &&
      (!attachedPreviewImageUrl ||
        resolvedImageUrl !== attachedPreviewImageUrl ||
        !hasStoredAttachedPreview);
    const storedImage =
      shouldStorePreviewImage && resolvedImageUrl
        ? await storeLinkPreviewImage(ctx, resolvedImageUrl, keyBase)
        : null;
    const linkPreview = buildSuccessPreview(normalizedUrl, {
      ...parsedWithPrimary,
      ...(storedInstagramMedia?.length ? { media: storedInstagramMedia } : {}),
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
  handler: (ctx: any, args: any) =>
    withBackendErrorCapture(
      {
        cardId: args.cardId,
        name: "card.link_metadata",
        operation: TELEMETRY_OPERATIONS.workflowStep,
        stage: "link_metadata",
        surface: "backend",
      },
      () => fetchMetadataHandler(ctx, args)
    ),
});
