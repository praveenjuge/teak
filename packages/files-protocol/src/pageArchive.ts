/** `archive-page`: a link's saved copy, written to `destinationKey`. */
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

/** Why `archive-page` stored nothing; the step marks the stage failed. */
export type FilesArchivePageFailure =
  | "blocked_url"
  | "http_error"
  | "not_html"
  | "too_large"
  | "unreachable";

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
