"use node";

import { lookup } from "node:dns/promises";
import { gunzipSync } from "node:zlib";
import {
  type FilesLinkPageResult,
  type FilesRemoteAssetKind,
  type FilesRemoteAssetResult,
  guessImageContentType,
  isRemoteAssetPageUrl,
} from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { internalAction } from "../../../_generated/server";
import type {
  LinkPreviewMediaItem,
  ScrapeResponse,
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
  fetchSocialPostMetadata,
  mapOpenGraphSocialPost,
  type SocialPostMedia,
  type SocialPostMetadata,
  toSocialPostPreviewFields,
} from "../../../linkMetadata/socialPost";
import {
  assertUrlIsSafe,
  type DnsResolver,
  readBodyWithLimit,
  SsrfError,
  safeFetch,
} from "../../../linkMetadata/ssrf";
import { buildSelectorResultsFromHtml } from "../../../linkMetadata/staticHtml";
import { fetchXStatusMetadata, isXStatusUrl } from "../../../linkMetadata/x";
import { TELEMETRY_OPERATIONS } from "../../../shared/telemetry";
import {
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "../../../storage/filesWorkerClient";
import { ensureObjectOwnership } from "../../../storage/ownership";
import { buildR2ObjectKey } from "../../../storage/r2";
import { withBackendErrorCapture } from "../../../telemetry/posthog";
import { pinnedFetch } from "../pinnedFetch";
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
const MAX_REMOTE_HTML_BYTES = 2 * 1024 * 1024;

type PersistableLinkMedia = SocialPostMedia | InstagramPostMedia;

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
  contentType: string;
  height?: number;
  storageKey: string;
  updatedAt: number;
  width?: number;
}

/**
 * Download a remote asset straight into R2 through the Files Worker's link
 * fetcher Container, which applies the same SSRF policy, address pinning,
 * size and type limits, and image check this action used to. The bytes never
 * pass through Convex. Any failure leaves the preview without the asset.
 */
const storeRemoteAsset = async (
  ctx: any,
  assetUrl: string,
  {
    fallbackContentType,
    key,
    kind,
    pageUrl,
    userId,
  }: {
    fallbackContentType?: string;
    key: string;
    kind: FilesRemoteAssetKind;
    /** The page the asset came from; its origin goes out as the Referer. */
    pageUrl: string;
    userId: string;
  }
): Promise<StoredRemoteAsset | null> => {
  try {
    await ensureObjectOwnership(ctx, userId, key);
    const outcome = await callFilesWorkerJson<FilesRemoteAssetResult>({
      op: "store-remote-asset",
      params: {
        destinationKey: key,
        kind,
        url: assetUrl,
        ...(fallbackContentType ? { fallbackContentType } : {}),
        // An overlong page URL just goes without a Referer.
        ...(isRemoteAssetPageUrl(pageUrl) ? { pageUrl } : {}),
      },
    });
    if (outcome.kind !== "ok") {
      console.warn(
        `[linkMetadata] Remote asset fetch unavailable for ${assetUrl}`
      );
      return null;
    }
    if (!outcome.data.stored) {
      console.warn(
        `[linkMetadata] Remote asset skipped (${outcome.data.reason}${
          outcome.data.status ? ` ${outcome.data.status}` : ""
        }) for ${assetUrl}`
      );
      return null;
    }
    return {
      contentType: outcome.data.contentType,
      storageKey: key,
      updatedAt: Date.now(),
      ...(outcome.data.width && outcome.data.height
        ? { height: outcome.data.height, width: outcome.data.width }
        : {}),
    };
  } catch (error) {
    console.warn("[linkMetadata] Remote asset fetch error", error);
    return null;
  }
};

const storeLinkPreviewImage = async (
  ctx: any,
  imageUrl: string,
  keyBase: { cardId: string; userId: string },
  pageUrl: string
): Promise<StoredLinkImage | null> => {
  const storedAsset = await storeRemoteAsset(ctx, imageUrl, {
    pageUrl,
    userId: keyBase.userId,
    fallbackContentType: guessImageContentType(imageUrl) ?? undefined,
    key: buildR2ObjectKey({ ...keyBase, role: "link-preview-image" }),
    kind: "image",
  });

  // The fetcher stores an image only once it has read its dimensions.
  if (!(storedAsset?.width && storedAsset.height)) {
    return null;
  }

  return {
    imageStorageKey: storedAsset.storageKey,
    imageUpdatedAt: storedAsset.updatedAt,
    imageWidth: storedAsset.width,
    imageHeight: storedAsset.height,
  };
};

const storeLinkPreviewMediaItem = async (
  ctx: any,
  media: PersistableLinkMedia,
  keyBase: { cardId: string; userId: string },
  pageUrl: string
): Promise<LinkPreviewMediaItem | null> => {
  const storedMedia = await storeRemoteAsset(ctx, media.url, {
    pageUrl,
    userId: keyBase.userId,
    fallbackContentType: media.contentType,
    key: buildR2ObjectKey({ ...keyBase, role: `link-media-${media.type}` }),
    kind: media.type,
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
      pageUrl,
      userId: keyBase.userId,
      fallbackContentType: media.posterContentType,
      key: buildR2ObjectKey({ ...keyBase, role: "link-media-poster" }),
      kind: "image",
    });

    if (storedPoster) {
      posterStorageKey = storedPoster.storageKey;
      posterUpdatedAt = storedPoster.updatedAt;
      posterContentType = storedPoster.contentType;
      posterWidth = storedPoster.width ?? posterWidth;
      posterHeight = storedPoster.height ?? posterHeight;
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
  keyBase: { cardId: string; userId: string },
  pageUrl: string
): Promise<LinkPreviewMediaItem[] | undefined> => {
  if (!media?.length) {
    return;
  }

  const storedMedia = await Promise.all(
    media.map((item) => storeLinkPreviewMediaItem(ctx, item, keyBase, pageUrl))
  );
  const persistedMedia = storedMedia.filter(
    (item): item is LinkPreviewMediaItem => Boolean(item)
  );
  return persistedMedia.length ? persistedMedia : undefined;
};

interface PageScrape {
  /** The URL, or a redirect, fails the SSRF policy. */
  blocked?: true;
  /** The decoded page, for parsers that need all of it (Instagram media). */
  html: () => string | null;
  /** The page's URL after redirects. */
  pageUrl: string;
  payload: ScrapeResponse;
}

/**
 * Fetch and scrape the page on the Files Worker's link fetcher, under the
 * same SSRF policy and address pinning, falling back there to an offline
 * Browser Run render when the static HTML has no metadata. A busy, failing
 * or slow Worker throws a retryable error so the step runs again.
 */
const scrapeWithFilesWorker = async (
  url: string,
  selectors: { selector: string }[]
): Promise<PageScrape> => {
  let page: FilesLinkPageResult;
  try {
    const outcome = await callFilesWorkerJson<FilesLinkPageResult>({
      op: "fetch-link-page",
      params: { selectors: selectors.map(({ selector }) => selector), url },
    });
    if (outcome.kind !== "ok") {
      throw new Error(`files_worker_${outcome.code}: ${outcome.message}`);
    }
    page = outcome.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[linkMetadata] Link page fetch unavailable", { message });
    return throwRetryable({
      type: "scrape_error",
      normalizedUrl: url,
      message: "Link page fetch unavailable",
      details: { error: message },
    });
  }

  if (!page.fetched) {
    return {
      ...(page.reason === "blocked_url" ? { blocked: true as const } : {}),
      html: () => null,
      pageUrl: url,
      payload: {
        success: false,
        errors: [
          page.reason === "http_error" && page.status
            ? { code: page.status, message: `HTTP ${page.status}` }
            : {
                message: page.contentType
                  ? `${page.reason}: ${page.contentType}`
                  : page.reason,
              },
        ],
      },
    };
  }
  return {
    html: () =>
      gunzipSync(Buffer.from(page.htmlGzipBase64, "base64")).toString("utf8"),
    pageUrl: page.pageUrl,
    payload: { success: true, result: { selectors: page.selectors } },
  };
};

/**
 * Without a Files Worker (a local stack), fetch the page here with the same
 * pinned policy and match the selectors against its static HTML only.
 */
const scrapeWithFetch = async (
  url: string,
  selectors: { selector: string }[]
): Promise<PageScrape> => {
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
        html: () => null,
        pageUrl: url,
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
        html: () => null,
        pageUrl: url,
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
      html: () => html,
      // safeFetch requests each redirect hop itself, so the response's URL
      // is the last one.
      pageUrl: response.url || url,
      payload: {
        success: true,
        result: { selectors: buildSelectorResultsFromHtml(html, selectors) },
      },
    };
  } catch (error) {
    return {
      html: () => null,
      pageUrl: url,
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
  const failBlocked = async () => {
    const message = "URL points to a disallowed destination";
    await ctx.runMutation(linkMetadataInternal.updateCardMetadata, {
      cardId,
      linkPreview: buildErrorPreview(normalizedUrl, {
        type: "blocked_url",
        message,
      }),
      status: "failed",
    });
    return {
      status: "failed" as const,
      normalizedUrl,
      errorType: "blocked_url",
      errorMessage: message,
    };
  };
  try {
    await assertUrlIsSafe(normalizedUrl, resolveDns);
  } catch (error) {
    if (error instanceof SsrfError) {
      return await failBlocked();
    }
    throw error;
  }

  // A post read from its site: store its media, then save it the way a
  // scraped page is saved.
  const saveSocialPost = async (post: SocialPostMetadata, pageUrl: string) => {
    const storedMedia = await storeLinkPreviewMedia(
      ctx,
      post.media,
      keyBase,
      pageUrl
    );
    const linkPreview = buildSuccessPreview(normalizedUrl, {
      ...toSocialPostPreviewFields(post),
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
  };

  try {
    if (isXStatusUrl(normalizedUrl)) {
      const xStatusMetadata = await fetchXStatusMetadata(normalizedUrl);

      if (xStatusMetadata) {
        return await saveSocialPost(xStatusMetadata, xStatusMetadata.finalUrl);
      }
    }

    // Bluesky, Mastodon, Reddit and TikTok answer from their APIs; anything
    // they can't (private, deleted, rate-limited) falls through to the page.
    const socialPost = await fetchSocialPostMetadata(normalizedUrl, {
      resolveDns,
      pinnedFetch,
    });
    if (socialPost) {
      return await saveSocialPost(socialPost, socialPost.finalUrl);
    }

    const page = await (isFilesWorkerConfigured()
      ? scrapeWithFilesWorker
      : scrapeWithFetch)(normalizedUrl, SCRAPE_ELEMENTS);
    const { pageUrl, payload } = page;

    // A redirect to a disallowed destination fails like the URL itself.
    if (page.blocked) {
      return await failBlocked();
    }

    // A dead or forbidden link (404, 410, 401, 403, ...) will not recover on
    // retry, so store a failed preview instead of fetching it again.
    const staticStatus = payload.success
      ? undefined
      : scrapeHttpStatus(payload);
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

    if (!payload.success) {
      const errorMessage =
        payload.errors
          ?.map((error) => error?.message)
          .filter(Boolean)
          .join("; ") || "Unknown scrape error";
      throwRetryable({
        type: scrapeHttpStatus(payload) === 429 ? "rate_limit" : "scrape_error",
        normalizedUrl,
        message: errorMessage,
        details: { fallback: payload.errors },
      });
    }

    const parsed = parseLinkPreview(normalizedUrl, payload.result?.selectors);
    // Threads, LinkedIn and Substack Notes posts come from the same scrape.
    const openGraphPost = mapOpenGraphSocialPost(normalizedUrl, parsed);
    if (openGraphPost) {
      return await saveSocialPost(openGraphPost, pageUrl);
    }
    // Instagram posts embed their media in the page's relay JSON; og:image
    // stays the fallback when it is missing (a login wall).
    const html = isInstagramPostUrl(normalizedUrl) ? page.html() : null;
    const extractedInstagramMedia = html
      ? extractInstagramMediaFromHtml(normalizedUrl, html)
      : undefined;
    const storedInstagramMedia = extractedInstagramMedia?.length
      ? await storeLinkPreviewMedia(
          ctx,
          extractedInstagramMedia,
          keyBase,
          pageUrl
        )
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
        ? await storeLinkPreviewImage(ctx, resolvedImageUrl, keyBase, pageUrl)
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
