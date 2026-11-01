import type { FilesRemoteAssetKind } from "../../../../packages/files-protocol/src/remoteAsset";

export const FETCHER_PORT = 8080;
export const FETCHER_PROTOCOL = 3;
export const FETCHER_PATH = "/fetch";
export const FETCHER_PAGE_PATH = "/fetch-page";
/**
 * One request to addresses the Worker already checked, for `safeFetch`
 * running in the Worker: redirects come back unfollowed.
 */
export const FETCHER_HOP_PATH = "/hop";
/**
 * A hop like FETCHER_HOP_PATH whose body streams back as it arrives instead
 * of being held, for podcast episode audio.
 */
export const FETCHER_STREAM_PATH = "/hop-stream";

/** At most this many downloads at once; the next gets 503 `busy`. */
export const FETCHER_MAX_IN_FLIGHT = 4;
/**
 * Of those, at most this many streamed hops, which hold their slot until the
 * body ends, so page fetches always keep the rest.
 */
export const FETCHER_MAX_STREAMS = 1;

export interface FetcherRequest {
  fallbackContentType?: string;
  kind: FilesRemoteAssetKind;
  /** Its origin is sent as the Referer on every request for the asset. */
  pageUrl?: string;
  url: string;
}

export const FETCHER_HEADERS = {
  contentType: "x-teak-asset-content-type",
  height: "x-teak-asset-height",
  width: "x-teak-asset-width",
} as const;

export interface FetcherPageRequest {
  selectors: string[];
  url: string;
}

export type FetcherPageFailureReason =
  | "blocked_url"
  | "fetch_failed"
  | "http_error"
  | "too_large"
  | "unsupported_type";

/** A 200 from FETCHER_PAGE_PATH. Failures are 422 `{error, reason, ...}`. */
export interface FetcherPageResponse {
  /**
   * False when the page's Cache-Control says `no-store` or `private`, so the
   * Worker must not keep it for other requests.
   */
  cacheable: boolean;
  charset: string;
  html: string;
  pageUrl: string;
  selectors: Array<{
    results: Array<{
      attributes?: Array<{ name: string; value: string }>;
      html?: string;
      text?: string;
    }>;
    selector: string;
  }>;
}

export const FETCHER_HOP_REQUEST_HEADERS = ["accept", "user-agent"] as const;
/** The most bytes a hop returns, plus one so the caller can tell it was cut. */
export const FETCHER_HOP_MAX_BYTES = 4 * 1024 * 1024;
export const FETCHER_HOP_MAX_TIMEOUT_MS = 30_000;
export const FETCHER_STREAM_MAX_BYTES = 100 * 1024 * 1024;
export const FETCHER_STREAM_MAX_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * The methods a hop may send. HEAD is for the link check; a fetcher built
 * before it ignores `method` and sends GET, which answers the same question.
 */
export const FETCHER_HOP_METHODS = ["GET", "HEAD"] as const;

export interface FetcherHopRequest {
  addresses: string[];
  headers: Partial<
    Record<(typeof FETCHER_HOP_REQUEST_HEADERS)[number], string>
  >;
  maxBytes: number;
  method?: (typeof FETCHER_HOP_METHODS)[number];
  timeoutMs: number;
  url: string;
}

/**
 * A 200 from FETCHER_HOP_PATH or FETCHER_STREAM_PATH carries the upstream
 * body (at most `maxBytes + 1` bytes) with the upstream status and headers in these. A hop
 * the policy refuses, or that fails, is 422 `{error, reason}`.
 */
export const FETCHER_HOP_RESPONSE_HEADERS = {
  contentLength: "x-teak-hop-content-length",
  contentType: "x-teak-hop-content-type",
  location: "x-teak-hop-location",
  status: "x-teak-hop-status",
} as const;

export type FetcherHopFailureReason = "blocked_url" | "fetch_failed";
