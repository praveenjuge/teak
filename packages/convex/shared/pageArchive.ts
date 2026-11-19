import { FILES_ARCHIVE_PAGE_FAILURES } from "@teak/files-protocol";

export {
  PAGE_ARCHIVE_ROLE,
  PAGE_SNAPSHOT_MAX_BYTES,
  PAGE_SNAPSHOT_MAX_RAW_BYTES,
  PAGE_SNAPSHOT_ROLE,
} from "@teak/files-protocol";

/**
 * What the Worker reports, plus `archive_error` for a run that broke, and
 * the two kinds of `http_error` someone can act on: `page_gone` (404, 410)
 * and `site_refused` (the site turns automated visitors away).
 */
export const PAGE_ARCHIVE_FAILURE_REASONS = [
  ...FILES_ARCHIVE_PAGE_FAILURES,
  "archive_error",
  "page_gone",
  "site_refused",
] as const;

export type PageArchiveFailureReason =
  (typeof PAGE_ARCHIVE_FAILURE_REASONS)[number];

export const toPageArchiveFailureReason = (
  value: string | undefined
): PageArchiveFailureReason =>
  (PAGE_ARCHIVE_FAILURE_REASONS as readonly string[]).includes(value ?? "")
    ? (value as PageArchiveFailureReason)
    : "archive_error";

const GONE_STATUSES = new Set([404, 410]);
/** Login walls, paywalls, bot filters and rate limits that never let up. */
const REFUSED_STATUSES = new Set([401, 402, 403, 429, 451]);

/** The stage's reason for a failure, from the Worker's reason and HTTP status. */
export const pageArchiveFailureFor = (
  reason: string | undefined,
  httpStatus?: number
): PageArchiveFailureReason => {
  if (reason === "http_error" && httpStatus !== undefined) {
    if (GONE_STATUSES.has(httpStatus)) {
      return "page_gone";
    }
    if (REFUSED_STATUSES.has(httpStatus)) {
      return "site_refused";
    }
  }
  return toPageArchiveFailureReason(reason);
};

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
