/**
 * Export feature constants.
 *
 * Pure, dependency-free values shared by the export serializer, archive
 * builder, Convex functions, workflow, and cleanup cron. Keep this module free
 * of Convex/server imports so it can be unit tested directly.
 */

/** App name embedded in the manifest. */
export const APP_NAME = "Teak";

/**
 * Archive contract version. Bump when the ZIP layout or top-level contract
 * changes in a backwards-incompatible way.
 */
export const EXPORT_VERSION = 1;

/**
 * Card payload schema version. Bump when the shape of serialized card objects
 * in `cards.json` changes.
 */
export const SCHEMA_VERSION = 1;

/** Maximum estimated artifact size (uncompressed bytes) for a V1 export. */
export const MAX_EXPORT_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

/** Maximum number of active cards a V1 export may contain. */
export const MAX_EXPORT_CARDS = 10_000;

/** How long a completed artifact remains downloadable. */
export const EXPORT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Rolling window for the weekly quota of one successful export. */
export const EXPORT_QUOTA_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Signed download URL lifetime. */
export const DOWNLOAD_URL_TTL_SECONDS = 15 * 60; // 15 minutes

/** Number of attempts to read an original file before silently omitting it. */
export const MISSING_FILE_MAX_ATTEMPTS = 2; // initial try + one retry

/** Names of the JSON entries inside the archive. */
export const MANIFEST_ENTRY_NAME = "manifest.json";
export const CARDS_ENTRY_NAME = "cards.json";

/** Directory prefix for original files inside the archive. */
export const FILES_DIR = "files";

/** Failure classes recorded in operational telemetry (no PII). */
export const EXPORT_FAILURE_CLASS = {
  CAP_EXCEEDED: "cap_exceeded",
  ARCHIVE_FAILED: "archive_failed",
  STORAGE_FAILED: "storage_failed",
  CANCELED: "canceled",
  UNKNOWN: "unknown",
} as const;

export type ExportFailureClass =
  (typeof EXPORT_FAILURE_CLASS)[keyof typeof EXPORT_FAILURE_CLASS];

/** Job lifecycle statuses. */
export const EXPORT_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  READY: "ready",
  FAILED: "failed",
  CANCELED: "canceled",
  EXPIRED: "expired",
} as const;

export type ExportStatus =
  (typeof EXPORT_STATUS)[keyof typeof EXPORT_STATUS];

/** Statuses that represent an in-flight job (occupies the single active slot). */
export const ACTIVE_EXPORT_STATUSES: ExportStatus[] = [
  EXPORT_STATUS.PENDING,
  EXPORT_STATUS.RUNNING,
];
