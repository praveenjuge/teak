const MIB = 1024 * 1024;

/** The role of a link's saved copy under its card's keys. */
export const PAGE_ARCHIVE_ROLE = "page-archive";
/** The role of a page the browser extension sent, until it is archived. */
export const PAGE_SNAPSHOT_ROLE = "page-snapshot";
/** A sent page's gzipped size limit, and its size once unzipped. */
export const PAGE_SNAPSHOT_MAX_BYTES = 20 * MIB;
export const PAGE_SNAPSHOT_MAX_RAW_BYTES = 60 * MIB;
/**
 * The largest saved copy a screenshot is taken from: a copy within the
 * snapshot budget plus room for its markup, well under the 32 MiB a message
 * to Browser Run may carry.
 */
export const PAGE_ARCHIVE_SCREENSHOT_MAX_BYTES =
  PAGE_SNAPSHOT_MAX_BYTES + 4 * MIB;

/** Why `archive-page` stored nothing; the step marks the stage failed. */
export const FILES_ARCHIVE_PAGE_FAILURES = [
  "blocked_url",
  "too_large",
  "http_error",
  "not_html",
  "unreachable",
] as const;
export type FilesArchivePageFailure =
  (typeof FILES_ARCHIVE_PAGE_FAILURES)[number];

export interface FilesArchivePageParams {
  /** When the copy is taken, recorded inside it. */
  capturedAt: number;
  /** `<prefix>users/<hash>/cards/<card id>/page-archive/<id>-archive.html`. */
  destinationKey: string;
  /** Fetch the page again instead of using the 24-hour copy. */
  fresh?: true;
  /**
   * The browser extension's gzipped page, a pending upload in the same
   * account. A missing or oversized one falls back to fetching the page.
   */
  snapshotKey?: string;
  url: string;
}

export type FilesArchivePageResult =
  | {
      bytes: number;
      kind: "full" | "text_only";
      /** The page the copy is of: its final URL, or where the extension was. */
      pageUrl: string;
      source: "extension" | "server";
      storageKey: string;
      stored: true;
    }
  | { reason: FilesArchivePageFailure; status?: number; stored: false };
