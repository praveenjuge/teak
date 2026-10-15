/**
 * fetch-link-page: fetch a saved link's page and scrape its preview metadata.
 * The link fetcher Container fetches the page under Convex's SSRF policy and
 * address pinning and matches the selectors against its static HTML with
 * Convex's own parser (fetcher/src/fetchPage.ts). When that finds nothing, as
 * on pages that build their tags in script, the same HTML is rendered offline
 * on Browser Run, which is what Convex did as a second call.
 *
 * Fetched pages are kept in KV for a day, keyed by URL and selectors, so a
 * link many people save is fetched and rendered once. Every fetch is
 * anonymous (no cookies or credentials), so any requester of the same URL
 * would get the same page; pages marked `no-store` or `private`, and
 * refusals, are never kept.
 */

import {
  FILES_LINK_PAGE_MAX_URL_LENGTH,
  type FilesLinkPageFailureReason,
  type FilesLinkPageParams,
  type FilesLinkPageResult,
  type FilesScrapeResult,
} from "@teak/files-protocol";
import {
  FETCHER_PAGE_PATH,
  type FetcherPageRequest,
  type FetcherPageResponse,
} from "../fetcher/src/protocol";
import { validScrapeSelectors } from "./browserRender";
import { sha256Hex } from "./lib";
import { postToFetcher, type RemoteAssetEnv } from "./remoteAsset";
import { RendererUnavailable } from "./rendererClient";

export type LinkPageEnv = Pick<
  RemoteAssetEnv,
  "LINK_FETCHER" | "LINK_FETCHER_INSTANCES"
> & {
  /** Fetched pages for a day; unset (no caching) outside production. */
  LINK_PAGE_CACHE?: KVNamespace;
};

/** How long a fetched page is reused. */
export const LINK_PAGE_CACHE_TTL_SECONDS = 24 * 60 * 60;

export interface LinkPageDeps {
  random?: () => number;
  /** Browser Run scrape of offline HTML; unset when there is no browser. */
  scrape?: (html: string, selectors: string[]) => Promise<FilesScrapeResult>;
}

const FAILURE_REASONS = new Set<FilesLinkPageFailureReason>([
  "blocked_url",
  "fetch_failed",
  "http_error",
  "too_large",
  "unsupported_type",
]);

export const parseLinkPageParams = (
  params: Record<string, unknown>
): FilesLinkPageParams => {
  const { url } = params;
  if (
    typeof url !== "string" ||
    !url ||
    url.length > FILES_LINK_PAGE_MAX_URL_LENGTH
  ) {
    throw new Error("invalid_link_page_params");
  }
  return { selectors: validScrapeSelectors(params.selectors), url };
};

/** An older fetcher image leaves out `cacheable`. */
type PageResponse = Omit<FetcherPageResponse, "cacheable"> &
  Partial<Pick<FetcherPageResponse, "cacheable">>;

const isPageResponse = (value: unknown): value is PageResponse => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const { cacheable, charset, html, pageUrl, selectors } = value as Record<
    string,
    unknown
  >;
  return (
    typeof charset === "string" &&
    typeof html === "string" &&
    (cacheable === undefined || typeof cacheable === "boolean") &&
    typeof pageUrl === "string" &&
    /^https?:\/\//i.test(pageUrl) &&
    Array.isArray(selectors) &&
    selectors.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof (entry as { selector?: unknown }).selector === "string" &&
        Array.isArray((entry as { results?: unknown }).results)
    )
  );
};

const hasResults = (selectors: FilesScrapeResult["selectors"]) =>
  selectors.some((entry) => entry.results.length > 0);

/** The page as UTF-8, gzipped and base64 encoded for the JSON result. */
const gzipBase64 = async (text: string): Promise<string> => {
  const compressed = new Uint8Array(
    await new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))
    ).arrayBuffer()
  );
  let binary = "";
  const CHUNK = 0x80_00;
  for (let offset = 0; offset < compressed.length; offset += CHUNK) {
    binary += String.fromCharCode(
      ...compressed.subarray(offset, offset + CHUNK)
    );
  }
  return btoa(binary);
};

const readFailure = async (
  response: Response
): Promise<FilesLinkPageResult> => {
  const body = (await response.json().catch(() => null)) as {
    contentType?: unknown;
    reason?: unknown;
    status?: unknown;
  } | null;
  const reason = FAILURE_REASONS.has(body?.reason as FilesLinkPageFailureReason)
    ? (body?.reason as FilesLinkPageFailureReason)
    : "fetch_failed";
  return {
    fetched: false,
    reason,
    ...(typeof body?.status === "number" ? { status: body.status } : {}),
    ...(typeof body?.contentType === "string"
      ? { contentType: body.contentType }
      : {}),
  };
};

// The version changes whenever the cached result's shape or meaning does.
const cacheKey = async ({ selectors, url }: FilesLinkPageParams) =>
  `link-page:v1:${await sha256Hex(JSON.stringify([url, selectors]))}`;

const readCached = async (
  cache: KVNamespace,
  key: string
): Promise<Extract<FilesLinkPageResult, { fetched: true }> | null> => {
  try {
    const value = await cache.get<FilesLinkPageResult>(key, "json");
    return value?.fetched === true ? value : null;
  } catch (error) {
    // A cache that cannot be read is a miss, never a failed fetch.
    console.warn("fetch-link-page: cache read failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const writeCached = async (
  cache: KVNamespace,
  key: string,
  result: FilesLinkPageResult
) => {
  try {
    await cache.put(key, JSON.stringify(result), {
      expirationTtl: LINK_PAGE_CACHE_TTL_SECONDS,
    });
  } catch (error) {
    console.warn("fetch-link-page: cache write failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export const fetchLinkPage = async (
  env: LinkPageEnv,
  params: FilesLinkPageParams,
  deps: LinkPageDeps = {}
): Promise<FilesLinkPageResult> => {
  const cache = env.LINK_PAGE_CACHE;
  const key = cache ? await cacheKey(params) : "";
  const cached = cache ? await readCached(cache, key) : null;
  if (cached) {
    return cached;
  }

  const request: FetcherPageRequest = {
    selectors: params.selectors,
    url: params.url,
  };
  const response = await postToFetcher(
    env,
    FETCHER_PAGE_PATH,
    request,
    deps.random
  );
  if (response.status === 422) {
    return await readFailure(response);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new RendererUnavailable(`fetcher_status_${response.status}`);
  }
  const page = await response.json().catch(() => null);
  if (!isPageResponse(page)) {
    throw new RendererUnavailable("fetcher_bad_response");
  }

  let { selectors } = page;
  let source: "browser" | "static" = "static";
  // A render that failed is retried by the next save, so it is not kept.
  let renderFailed = false;
  // As Convex did: a browser result replaces the static one even when it is
  // also empty, and a failed or unavailable browser keeps the static one.
  if (page.html && !hasResults(selectors) && deps.scrape) {
    try {
      selectors = (await deps.scrape(page.html, params.selectors)).selectors;
      source = "browser";
    } catch (error) {
      renderFailed = true;
      console.warn("fetch-link-page: browser scrape failed; keeping static", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const result: FilesLinkPageResult = {
    charset: page.charset,
    fetched: true,
    htmlGzipBase64: await gzipBase64(page.html),
    pageUrl: page.pageUrl,
    selectors,
    source,
  };
  // An older fetcher image does not say, so its pages are not kept.
  if (cache && page.cacheable === true && !renderFailed) {
    await writeCached(cache, key, result);
  }
  return result;
};
