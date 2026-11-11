import type { FilesScrapeResult } from "./rendering";

export const FILES_LINK_PAGE_MAX_URL_LENGTH = 4096;

export interface FilesLinkPageParams {
  /** Skip the kept copy and fetch the page again; the new copy is kept. */
  fresh?: boolean;
  selectors: string[];
  url: string;
}

export const FILES_LINK_PAGE_FAILURE_REASONS = [
  "blocked_url",
  "fetch_failed",
  "http_error",
  "too_large",
  "unsupported_type",
] as const;

export type FilesLinkPageFailureReason =
  (typeof FILES_LINK_PAGE_FAILURE_REASONS)[number];

export const isLinkPageFailureReason = (
  value: unknown
): value is FilesLinkPageFailureReason =>
  (FILES_LINK_PAGE_FAILURE_REASONS as readonly unknown[]).includes(value);

export type FilesLinkPageResult =
  | {
      charset: string;
      fetched: true;
      htmlGzipBase64: string;
      pageUrl: string;
      selectors: FilesScrapeResult["selectors"];
      source: "browser" | "static";
    }
  | {
      contentType?: string;
      fetched: false;
      reason: FilesLinkPageFailureReason;
      status?: number;
    };
