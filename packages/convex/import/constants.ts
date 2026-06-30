export const IMPORT_PART_BYTES = 64 * 1024 * 1024;
export const IMPORT_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_BOOKMARK_BYTES = 20 * 1024 * 1024;
export const MAX_RAINDROP_BYTES = 20 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024 * 1024;
export const MAX_IMPORT_CARDS = 10_000;
export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_IMPORT_EXPANDED_BYTES = 5 * 1024 * 1024 * 1024;
export const MAX_IMPORT_JSON_BYTES = 64 * 1024 * 1024;
export const IMPORT_CARD_BATCH = 5;
export const IMPORT_INDEX_BATCH = 100;
export const IMPORT_FAILURE_SAMPLE_LIMIT = 25;

export const ACTIVE_IMPORT_STATUSES = [
  "uploading",
  "queued",
  "parsing",
  "importing",
] as const;

export const TERMINAL_IMPORT_STATUSES = [
  "completed",
  "failed",
  "canceled",
] as const;

export type ImportMode = "bookmarks" | "archive" | "raindrop";
