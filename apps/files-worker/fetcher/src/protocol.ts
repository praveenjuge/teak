/** The HTTP contract between the Files Worker and its link fetcher Container. */

import type { FilesRemoteAssetKind } from "../../../../packages/files-protocol/src/remoteAsset";

export const FETCHER_PORT = 8080;
export const FETCHER_PROTOCOL = 1;
export const FETCHER_PATH = "/fetch";
/** Fetch a link's page and match scrape selectors against its static HTML. */
export const FETCHER_PAGE_PATH = "/fetch-page";

/** At most this many downloads at once; the next gets 503 `busy`. */
export const FETCHER_MAX_IN_FLIGHT = 4;

export interface FetcherRequest {
  fallbackContentType?: string;
  kind: FilesRemoteAssetKind;
  /** Its origin is sent as the Referer on every request for the asset. */
  pageUrl?: string;
  url: string;
}

/** Facts about a 200 response's bytes, sent as response headers. */
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
