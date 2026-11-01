const MIB = 1024 * 1024;

export const PAGE_ARCHIVE_ROLE = "page-archive";
export const PAGE_SNAPSHOT_ROLE = "page-snapshot";
export const PAGE_SNAPSHOT_MAX_BYTES = 20 * MIB;
export const PAGE_SNAPSHOT_MAX_RAW_BYTES = 60 * MIB;

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

export const toPageArchiveFailureReason = (
  value: string | undefined
): PageArchiveFailureReason =>
  (PAGE_ARCHIVE_FAILURE_REASONS as readonly string[]).includes(value ?? "")
    ? (value as PageArchiveFailureReason)
    : "archive_error";

export type PageArchiveSkip =
  | "already_archived"
  | "frozen"
  | "no_url"
  | "not_link"
  | "trashed";

export interface PageArchiveCandidate {
  hasHighlights?: boolean;
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
 * the extension sent the page again since. A card with highlights keeps its
 * copy whatever asks (`frozen`): its highlights were made in the article
 * taken from it. Its first copy is still made, for highlights an import
 * brought before there was one.
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
  if (archive && card.hasHighlights) {
    return "frozen";
  }
  if (!archive || options.refresh === true) {
    return null;
  }
  const freshSnapshot =
    card.pendingPageSnapshotKey !== undefined &&
    (card.pendingPageSnapshotAt ?? 0) > archive.capturedAt;
  return freshSnapshot ? null : "already_archived";
};
