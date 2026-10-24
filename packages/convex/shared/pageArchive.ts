/**
 * A link's saved copy (`cards.pageArchive`): the rules the Convex backend,
 * the Files Worker and the web app share.
 */

const MIB = 1024 * 1024;

/** The R2 role of an archive object. */
export const PAGE_ARCHIVE_ROLE = "page-archive";
/** The R2 role of a page the browser extension uploaded, before archiving. */
export const PAGE_SNAPSHOT_ROLE = "page-snapshot";
/** The most a gzipped snapshot from the extension may weigh. */
export const PAGE_SNAPSHOT_MAX_BYTES = 20 * MIB;
/** The most a snapshot may weigh once unzipped. */
export const PAGE_SNAPSHOT_MAX_RAW_BYTES = 60 * MIB;

/** Why a page has no saved copy, as `processingStatus.archive.error` says. */
export const PAGE_ARCHIVE_FAILURE_REASONS = [
  "blocked_url",
  "too_large",
  "http_error",
  "not_html",
  "unreachable",
  "archive_error",
] as const;

export type PageArchiveFailureReason =
  (typeof PAGE_ARCHIVE_FAILURE_REASONS)[number];

/** A stored reason, or `archive_error` for one this code doesn't know. */
export const toPageArchiveFailureReason = (
  value: string | undefined
): PageArchiveFailureReason =>
  (PAGE_ARCHIVE_FAILURE_REASONS as readonly string[]).includes(value ?? "")
    ? (value as PageArchiveFailureReason)
    : "archive_error";

export type PageArchiveSkip =
  | "already_archived"
  | "no_url"
  | "not_link"
  | "trashed";

export interface PageArchiveCandidate {
  isDeleted?: boolean;
  pageArchive?: { capturedAt: number };
  pendingPageSnapshotAt?: number;
  pendingPageSnapshotKey?: string;
  type: string;
  url?: string;
}

/**
 * Why the "archive page" step leaves a card alone, or null to archive it.
 * A card keeps the copy it has, unless Refresh details asked for a new one or
 * the extension sent the page again since. Phase 8 adds: a card with
 * highlights keeps its copy.
 */
export const pageArchiveSkipReason = (
  card: PageArchiveCandidate,
  options: { refresh?: boolean } = {}
): PageArchiveSkip | null => {
  if (card.type !== "link") {
    return "not_link";
  }
  if (!card.url) {
    return "no_url";
  }
  if (card.isDeleted) {
    return "trashed";
  }
  const archive = card.pageArchive;
  if (!archive || options.refresh === true) {
    return null;
  }
  const freshSnapshot =
    card.pendingPageSnapshotKey !== undefined &&
    (card.pendingPageSnapshotAt ?? 0) > archive.capturedAt;
  return freshSnapshot ? null : "already_archived";
};
