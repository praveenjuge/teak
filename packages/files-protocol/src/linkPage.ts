/**
 * fetch-link-page: fetch a saved link's page through the link fetcher
 * Container (Convex's SSRF policy and address pinning), match the scrape
 * selectors against its static HTML with Convex's own parser, and fall back to
 * an offline Browser Run render when the static HTML has no matches.
 */

import type { FilesScrapeResult } from "./rendering";

export const FILES_LINK_PAGE_MAX_URL_LENGTH = 4096;

export interface FilesLinkPageParams {
  /** CSS selectors, as `scrape-html` takes them. */
  selectors: string[];
  url: string;
}

export type FilesLinkPageFailureReason =
  /** The URL, or a redirect, fails the SSRF policy. */
  | "blocked_url"
  /** DNS, connection, TLS or timeout failure, or too many redirects. */
  | "fetch_failed"
  /** The page answered with a non-2xx status (in `status`). */
  | "http_error"
  | "too_large"
  /** Not `text/html` (the type is in `contentType`). */
  | "unsupported_type";

export type FilesLinkPageResult =
  | {
      /** The encoding the HTML was decoded with. */
      charset: string;
      fetched: true;
      /** The decoded page, UTF-8 and gzipped, for parsers that need it. */
      htmlGzipBase64: string;
      /** The page's URL after redirects. */
      pageUrl: string;
      selectors: FilesScrapeResult["selectors"];
      /** `browser` when the static HTML matched nothing and Browser Run did. */
      source: "browser" | "static";
    }
  | {
      contentType?: string;
      fetched: false;
      reason: FilesLinkPageFailureReason;
      status?: number;
    };
