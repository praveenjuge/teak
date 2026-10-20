import { internal } from "@teak/convex/_generated/api";
import {
  type InstagramPostMedia,
  isInstagramPostUrl,
} from "@teak/convex/linkMetadata/instagram";
import { extractInstagramMediaFromHtml } from "@teak/convex/linkMetadata/instagramHtml";
import {
  buildErrorPreview,
  buildSuccessPreview,
  parseLinkPreview,
} from "@teak/convex/linkMetadata/parsing";
import { SCRAPE_ELEMENTS } from "@teak/convex/linkMetadata/selectors";
import {
  fetchSocialPostMetadata,
  mapOpenGraphSocialPost,
  type SocialPostMedia,
  type SocialPostMetadata,
  toSocialPostPreviewFields,
} from "@teak/convex/linkMetadata/socialPost";
import { assertUrlIsSafe, SsrfError } from "@teak/convex/linkMetadata/ssrf";
import type {
  LinkPreviewMediaItem,
  LinkPreviewMetadata,
  ScrapeResponse,
} from "@teak/convex/linkMetadata/types";
import { normalizeUrl } from "@teak/convex/linkMetadata/url";
import {
  fetchXStatusMetadata,
  isXStatusUrl,
} from "@teak/convex/linkMetadata/x";
import {
  type FilesLinkPageResult,
  type FilesRemoteAssetKind,
  type FilesRemoteAssetResult,
  guessImageContentType,
  isRemoteAssetPageUrl,
} from "@teak/files-protocol";
import {
  type CardJob,
  ensureObjectOwnership,
  guardOf,
  type LoadedCard,
  loadCard,
  objectKey,
} from "./context";
import { archiveRawMetadata } from "./rawMetadata";

export const LINK_METADATA_RETRYABLE_PREFIX =
  "workflow:linkMetadata:retryable:";

interface LinkMetadataRetryableError {
  details?: unknown;
  message?: string;
  normalizedUrl?: string;
  type: string;
}

const throwRetryable = (info: LinkMetadataRetryableError): never => {
  throw new Error(`${LINK_METADATA_RETRYABLE_PREFIX}${JSON.stringify(info)}`);
};

const errorFields = (error: unknown): { message?: string; name?: string } => {
  if (typeof error !== "object" || error === null) {
    return {};
  }
  const { message, name } = error as { message?: unknown; name?: unknown };
  return {
    ...(typeof message === "string" ? { message } : {}),
    ...(typeof name === "string" ? { name } : {}),
  };
};

export const parseLinkMetadataRetryableError = (
  error: unknown
): LinkMetadataRetryableError | null => {
  const message = error instanceof Error ? error.message : String(error);
  const start = message.indexOf(LINK_METADATA_RETRYABLE_PREFIX);
  if (start === -1) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      message.slice(start + LINK_METADATA_RETRYABLE_PREFIX.length)
    ) as LinkMetadataRetryableError;
    return parsed && typeof parsed.type === "string" ? parsed : null;
  } catch {
    return null;
  }
};

export const keepPreviewAfterFailedRefresh = async (
  job: CardJob,
  failure: LinkMetadataRetryableError
): Promise<void> => {
  await job.deps.convex.mutation(
    internal.linkMetadata.updateCardMetadata,
    {
      cardId: job.cardId,
      linkPreview: buildErrorPreview(failure.normalizedUrl ?? "", {
        type: failure.type || "error",
        message: failure.message,
        ...(failure.details ? { details: failure.details } : {}),
      }),
      refresh: true,
      status: "failed",
    },
    guardOf(job)
  );
};

export interface LinkMetadataResult {
  errorType?: string;
  status: "failed" | "skipped" | "success";
}

type PersistableLinkMedia = SocialPostMedia | InstagramPostMedia;

export const gunzipBase64 = async (value: string): Promise<string> => {
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  return await new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))
  ).text();
};

export const fetchLinkPageForCard = (job: CardJob, url: string) =>
  job.deps.filesOp<FilesLinkPageResult>({
    op: "fetch-link-page",
    params: {
      selectors: SCRAPE_ELEMENTS.map(({ selector }) => selector),
      url,
    },
  });

interface StoredRemoteAsset {
  contentType: string;
  height?: number;
  storageKey: string;
  updatedAt: number;
  width?: number;
}

const storeRemoteAsset = async (
  job: CardJob,
  loaded: LoadedCard,
  assetUrl: string,
  {
    fallbackContentType,
    kind,
    pageUrl,
    role,
  }: {
    fallbackContentType?: string;
    kind: FilesRemoteAssetKind;
    pageUrl: string;
    role: string;
  }
): Promise<StoredRemoteAsset | null> => {
  const key = objectKey(loaded, { cardId: job.cardId, role });
  try {
    await ensureObjectOwnership(job, loaded.card.userId, key);
    const outcome = await job.deps.filesOp<FilesRemoteAssetResult>({
      op: "store-remote-asset",
      params: {
        destinationKey: key,
        kind,
        url: assetUrl,
        ...(fallbackContentType ? { fallbackContentType } : {}),
        ...(isRemoteAssetPageUrl(pageUrl) ? { pageUrl } : {}),
      },
    });
    if (outcome.kind !== "ok") {
      console.warn("[linkMetadata] Remote asset fetch unavailable");
      return null;
    }
    if (!outcome.data.stored) {
      console.warn("[linkMetadata] Remote asset skipped", {
        reason: outcome.data.reason,
        status: outcome.data.status,
      });
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
    if (error instanceof Error && error.name === "NonRetryableError") {
      throw error;
    }
    console.warn("[linkMetadata] Remote asset fetch error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

export const storeLinkPreviewImage = async (
  job: CardJob,
  loaded: LoadedCard,
  imageUrl: string,
  pageUrl: string
) => {
  const stored = await storeRemoteAsset(job, loaded, imageUrl, {
    fallbackContentType: guessImageContentType(imageUrl) ?? undefined,
    kind: "image",
    pageUrl,
    role: "link-preview-image",
  });
  if (!(stored?.width && stored.height)) {
    return null;
  }
  return {
    imageHeight: stored.height,
    imageStorageKey: stored.storageKey,
    imageUpdatedAt: stored.updatedAt,
    imageWidth: stored.width,
  };
};

const storeLinkPreviewMediaItem = async (
  job: CardJob,
  loaded: LoadedCard,
  media: PersistableLinkMedia,
  pageUrl: string
): Promise<LinkPreviewMediaItem | null> => {
  const storedMedia = await storeRemoteAsset(job, loaded, media.url, {
    fallbackContentType: media.contentType,
    kind: media.type,
    pageUrl,
    role: `link-media-${media.type}`,
  });
  if (!storedMedia) {
    return null;
  }
  let poster:
    | {
        posterContentType?: string;
        posterHeight?: number;
        posterStorageKey: string;
        posterUpdatedAt: number;
        posterWidth?: number;
      }
    | undefined;
  if (media.type === "video" && media.posterUrl) {
    const storedPoster = await storeRemoteAsset(job, loaded, media.posterUrl, {
      fallbackContentType: media.posterContentType,
      kind: "image",
      pageUrl,
      role: "link-media-poster",
    });
    if (storedPoster) {
      poster = {
        posterContentType: storedPoster.contentType,
        posterHeight: storedPoster.height ?? media.posterHeight,
        posterStorageKey: storedPoster.storageKey,
        posterUpdatedAt: storedPoster.updatedAt,
        posterWidth: storedPoster.width ?? media.posterWidth,
      };
    }
  }
  return {
    contentType: storedMedia.contentType,
    height: media.height,
    storageKey: storedMedia.storageKey,
    type: media.type,
    updatedAt: storedMedia.updatedAt,
    width: media.width,
    ...(poster ?? {}),
  };
};

const storeLinkPreviewMedia = async (
  job: CardJob,
  loaded: LoadedCard,
  media: PersistableLinkMedia[] | undefined,
  pageUrl: string
): Promise<LinkPreviewMediaItem[] | undefined> => {
  if (!media?.length) {
    return;
  }
  const stored = await Promise.all(
    media.map((item) => storeLinkPreviewMediaItem(job, loaded, item, pageUrl))
  );
  const persisted = stored.filter((item): item is LinkPreviewMediaItem =>
    Boolean(item)
  );
  return persisted.length ? persisted : undefined;
};

interface PageScrape {
  blocked?: true;
  html: () => Promise<string | null>;
  /** A file (a PDF, an image), not a web page: fetching again won't change it. */
  notHtml?: { contentType?: string };
  pageUrl: string;
  payload: ScrapeResponse;
}

// Text, JSON or XML can stand in for a page for a moment (a maintenance or
// rate-limit reply), so only other types are a file that stays a file.
const PASSING_REPLY_TYPE_REGEX = /^text\/|[/+](?:json|xml)$/u;

const isFileType = (contentType: string | undefined): boolean => {
  const type = contentType?.split(";")[0]?.trim().toLowerCase();
  return Boolean(type) && !PASSING_REPLY_TYPE_REGEX.test(type ?? "");
};

const scrapePage = async (job: CardJob, url: string): Promise<PageScrape> => {
  let page: FilesLinkPageResult;
  try {
    const outcome = await fetchLinkPageForCard(job, url);
    if (outcome.kind !== "ok") {
      throw new Error(`files_worker_${outcome.code}: ${outcome.message}`);
    }
    page = outcome.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[linkMetadata] Link page fetch unavailable", { message });
    return throwRetryable({
      details: { error: message },
      message: "Link page fetch unavailable",
      normalizedUrl: url,
      type: "scrape_error",
    });
  }
  if (!page.fetched) {
    return {
      ...(page.reason === "blocked_url" ? { blocked: true as const } : {}),
      ...(page.reason === "unsupported_type" && isFileType(page.contentType)
        ? { notHtml: { contentType: page.contentType } }
        : {}),
      html: () => Promise.resolve(null),
      pageUrl: url,
      payload: {
        errors: [
          page.reason === "http_error" && page.status
            ? { code: page.status, message: `HTTP ${page.status}` }
            : {
                message: page.contentType
                  ? `${page.reason}: ${page.contentType}`
                  : page.reason,
              },
        ],
        success: false,
      },
    };
  }
  return {
    html: () => gunzipBase64(page.htmlGzipBase64),
    pageUrl: page.pageUrl,
    payload: { result: { selectors: page.selectors }, success: true },
  };
};

const RETRYABLE_CLIENT_STATUSES = new Set([408, 425, 429]);

export const isDefinitiveHttpClientError = (status: number | undefined) =>
  typeof status === "number" &&
  status >= 400 &&
  status < 500 &&
  !RETRYABLE_CLIENT_STATUSES.has(status);

const scrapeHttpStatus = (payload: ScrapeResponse): number | undefined =>
  payload.errors?.find((error) => typeof error?.code === "number")?.code;

export const fetchLinkMetadata = async (
  job: CardJob
): Promise<LinkMetadataResult> => {
  const { convex } = job.deps;
  const card = await convex.query(internal.linkMetadata.getCardForLinkFetch, {
    cardId: job.cardId,
  });
  let loaded: LoadedCard | null = null;
  const owner = async (): Promise<LoadedCard> => {
    loaded ??= await loadCard(job);
    if (!loaded) {
      throw new Error("card_missing");
    }
    return loaded;
  };
  // A Convex deployed before the reader returned its key prefix sends none;
  // the full card read gives it.
  const rawOwner = async () =>
    card?.keyPrefix === undefined
      ? await owner().then((found) => ({
          keyPrefix: found.keyPrefix,
          userId: found.card.userId,
        }))
      : { keyPrefix: card.keyPrefix, userId: card.userId };
  const save = async (
    linkPreview: LinkPreviewMetadata,
    status: "completed" | "failed"
  ) => {
    await convex.mutation(
      internal.linkMetadata.updateCardMetadata,
      {
        cardId: job.cardId,
        linkPreview:
          linkPreview.raw === undefined
            ? linkPreview
            : await archiveRawMetadata(
                job,
                await rawOwner(),
                "linkPreview",
                linkPreview
              ),
        ...(job.refresh ? { refresh: true } : {}),
        status,
      },
      guardOf(job)
    );
  };
  const fail = async (
    url: string,
    errorType: string,
    message: string,
    details?: Record<string, unknown>
  ): Promise<LinkMetadataResult> => {
    await save(
      buildErrorPreview(url, {
        type: errorType,
        message,
        ...(details ? { details } : {}),
      }),
      "failed"
    );
    return { errorType, status: "failed" };
  };

  if (!card?.url) {
    return await fail(
      card?.url ?? "",
      "invalid_card",
      "Card is missing a valid URL"
    );
  }

  const classificationStatus = card.processingStatus?.classify?.status;
  const classificationPending =
    classificationStatus === "pending" ||
    classificationStatus === "in_progress";
  if (classificationPending) {
    throwRetryable({
      message: "Waiting for classification to finish",
      normalizedUrl: card.url,
      type: "awaiting_classification",
    });
  }

  if (card.type !== "link") {
    return await fail(card.url, "invalid_card", "Card is not a link");
  }

  const normalizedUrl = normalizeUrl(card.url);

  if (
    (await convex.query(internal.adminAccess.isLinkFetchPaused, {})) === true
  ) {
    return await fail(
      normalizedUrl,
      "fetching_paused",
      "Link fetching is paused"
    );
  }

  const failBlocked = () =>
    fail(
      normalizedUrl,
      "blocked_url",
      "URL points to a disallowed destination"
    );
  try {
    await assertUrlIsSafe(normalizedUrl, job.deps.resolveDns);
  } catch (error) {
    if (error instanceof SsrfError) {
      return await failBlocked();
    }
    throw error;
  }

  const saveSocialPost = async (
    post: SocialPostMetadata,
    pageUrl: string
  ): Promise<LinkMetadataResult> => {
    const storedMedia = post.media?.length
      ? await storeLinkPreviewMedia(job, await owner(), post.media, pageUrl)
      : undefined;
    await save(
      buildSuccessPreview(normalizedUrl, {
        ...toSocialPostPreviewFields(post),
        media: storedMedia,
      }),
      "completed"
    );
    return { status: "success" };
  };

  try {
    if (isXStatusUrl(normalizedUrl)) {
      const xStatus = await fetchXStatusMetadata(normalizedUrl);
      if (xStatus) {
        return await saveSocialPost(xStatus, xStatus.finalUrl);
      }
    }

    const socialPost = await fetchSocialPostMetadata(normalizedUrl, {
      pinnedFetch: job.deps.pinnedFetch,
      resolveDns: job.deps.resolveDns,
    });
    if (socialPost) {
      return await saveSocialPost(socialPost, socialPost.finalUrl);
    }

    const page = await scrapePage(job, normalizedUrl);
    const { pageUrl, payload } = page;
    if (page.blocked) {
      return await failBlocked();
    }
    if (page.notHtml) {
      return await fail(
        normalizedUrl,
        "unsupported_type",
        "Link is a file, not a web page",
        page.notHtml.contentType
          ? { contentType: page.notHtml.contentType }
          : undefined
      );
    }

    const staticStatus = payload.success
      ? undefined
      : scrapeHttpStatus(payload);
    if (isDefinitiveHttpClientError(staticStatus)) {
      return await fail(normalizedUrl, "http_error", `HTTP ${staticStatus}`, {
        status: staticStatus,
      });
    }

    if (!payload.success) {
      const errorMessage =
        payload.errors
          ?.map((error) => error?.message)
          .filter(Boolean)
          .join("; ") || "Unknown scrape error";
      throwRetryable({
        details: { fallback: payload.errors },
        message: errorMessage,
        normalizedUrl,
        type: scrapeHttpStatus(payload) === 429 ? "rate_limit" : "scrape_error",
      });
    }

    const parsed = parseLinkPreview(normalizedUrl, payload.result?.selectors);
    const openGraphPost = mapOpenGraphSocialPost(normalizedUrl, parsed);
    if (openGraphPost) {
      return await saveSocialPost(openGraphPost, pageUrl);
    }
    // Instagram posts embed their media in the page's relay JSON; og:image
    // stays the fallback when it is missing (a login wall).
    const html = isInstagramPostUrl(normalizedUrl) ? await page.html() : null;
    const extractedInstagramMedia = html
      ? extractInstagramMediaFromHtml(normalizedUrl, html)
      : undefined;
    const storedInstagramMedia = extractedInstagramMedia?.length
      ? await storeLinkPreviewMedia(
          job,
          await owner(),
          extractedInstagramMedia,
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
        ? await storeLinkPreviewImage(
            job,
            await owner(),
            resolvedImageUrl,
            pageUrl
          )
        : null;
    await save(
      buildSuccessPreview(normalizedUrl, {
        ...parsedWithPrimary,
        ...(storedInstagramMedia?.length
          ? { media: storedInstagramMedia }
          : {}),
        ...(storedImage ?? {}),
      }),
      "completed"
    );
    return { status: "success" };
  } catch (error) {
    const { message, name } = errorFields(error);
    if (
      message?.startsWith(LINK_METADATA_RETRYABLE_PREFIX) ||
      name === "NonRetryableError"
    ) {
      throw error;
    }
    if (name === "AbortError") {
      throwRetryable({ message, normalizedUrl, type: "timeout" });
    }
    if (name === "TypeError" && message?.includes("fetch")) {
      throwRetryable({ message, normalizedUrl, type: "network_error" });
    }
    return await fail(normalizedUrl, "error", message ?? "error");
  }
};
