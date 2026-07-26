/**
 * Pure export serialization logic.
 *
 * This module is intentionally free of Convex/server imports so it can be unit
 * tested directly and reused by the workflow. It is responsible for:
 *   - deciding which cards are included (active only)
 *   - producing the user-facing card JSON with the correct field allow-list
 *     (excluding AI fields, scraped link metadata, account data, source
 *     metadata, thumbnails/screenshots/preview media, etc.)
 *   - building the manifest
 *   - sanitizing original filenames for archive paths
 *   - quota / cap / expiry predicates
 */

import {
  APP_NAME,
  EXPORT_QUOTA_WINDOW_MS,
  EXPORT_RETENTION_MS,
  EXPORT_VERSION,
  FILES_DIR,
  MAX_EXPORT_BYTES,
  MAX_EXPORT_CARDS,
  SCHEMA_VERSION,
} from "./constants";

/** Minimal shape of a stored card needed for serialization. */
export interface ExportableCard {
  _id: string;
  type: string;
  content?: string;
  url?: string;
  notes?: string;
  tags?: string[];
  isFavorited?: boolean;
  isDeleted?: boolean;
  deletedAt?: number;
  fileKey?: string;
  fileMetadata?: {
    fileSize?: number;
    fileName?: string;
    mimeType?: string;
    duration?: number;
    width?: number;
    height?: number;
    recordingTimestamp?: number;
  };
  colors?: Array<{
    hex: string;
    name?: string;
    rgb?: { r: number; g: number; b: number };
    hsl?: { h: number; s: number; l: number };
  }>;
  createdAt: number;
  updatedAt: number;
}

/** A timestamp expressed as both ISO 8601 and epoch milliseconds. */
export interface DualTimestamp {
  iso: string;
  epochMs: number;
}

export interface SerializedCardFile {
  /** Archive-relative path, e.g. files/<cardId>-<name>. Present only when included. */
  path: string;
  fileName: string;
  mimeType?: string;
  fileSize?: number;
  width?: number;
  height?: number;
  duration?: number;
}

export interface SerializedCard {
  id: string;
  type: string;
  content: string;
  url?: string;
  notes?: string;
  tags: string[];
  isFavorited: boolean;
  colors?: Array<{ hex: string; name?: string }>;
  file?: SerializedCardFile;
  createdAt: DualTimestamp;
  updatedAt: DualTimestamp;
}

/** A card is exportable when it has not been soft-deleted. */
export function isActiveCard(card: {
  isDeleted?: boolean;
}): boolean {
  return card.isDeleted !== true;
}

/** Build a dual ISO + epoch timestamp from epoch milliseconds. */
export function toDualTimestamp(epochMs: number): DualTimestamp {
  return {
    iso: new Date(epochMs).toISOString(),
    epochMs,
  };
}

/**
 * Sanitize an original filename for safe inclusion in the archive. Strips path
 * separators and unusual characters while preserving a readable extension.
 * Never returns an empty string.
 */
export function sanitizeFilename(rawName: string | undefined): string {
  const fallback = "file";
  if (!rawName) {
    return fallback;
  }
  // Drop any directory components.
  const base = rawName.split(/[/\\]/).pop() ?? rawName;
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .replace(/-+/g, "-")
    .slice(0, 120);
  const trimmed = cleaned.replace(/^-+|-+$/g, "");
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Compute the archive-relative path for a card's original file.
 * Format: files/<cardId>-<sanitized-original-filename>
 */
export function buildFilePath(cardId: string, rawName: string | undefined): string {
  return `${FILES_DIR}/${cardId}-${sanitizeFilename(rawName)}`;
}

/**
 * Serialize a single card to its user-facing export shape.
 *
 * `includeFile` indicates whether the original file was successfully read and
 * placed into the archive. When false (missing file omitted after retry), the
 * card is still serialized but without a `file` entry.
 */
export function serializeCard(
  card: ExportableCard,
  options: { includeFile: boolean } = { includeFile: false }
): SerializedCard {
  const serialized: SerializedCard = {
    id: card._id,
    type: card.type,
    content: card.content ?? "",
    tags: Array.isArray(card.tags) ? [...card.tags] : [],
    isFavorited: card.isFavorited === true,
    createdAt: toDualTimestamp(card.createdAt),
    updatedAt: toDualTimestamp(card.updatedAt),
  };

  if (typeof card.url === "string" && card.url.length > 0) {
    serialized.url = card.url;
  }
  if (typeof card.notes === "string" && card.notes.length > 0) {
    serialized.notes = card.notes;
  }

  // Visible palette colors only: hex + optional human-readable name. Drop rgb/hsl
  // derived representations to keep the payload to what the user sees.
  if (Array.isArray(card.colors) && card.colors.length > 0) {
    serialized.colors = card.colors.map((color) =>
      color.name ? { hex: color.hex, name: color.name } : { hex: color.hex }
    );
  }

  if (options.includeFile && card.type !== "text") {
    const fileName = sanitizeFilename(card.fileMetadata?.fileName);
    const file: SerializedCardFile = {
      path: buildFilePath(card._id, card.fileMetadata?.fileName),
      fileName,
    };
    if (card.fileMetadata?.mimeType) {
      file.mimeType = card.fileMetadata.mimeType;
    }
    if (typeof card.fileMetadata?.fileSize === "number") {
      file.fileSize = card.fileMetadata.fileSize;
    }
    if (typeof card.fileMetadata?.width === "number") {
      file.width = card.fileMetadata.width;
    }
    if (typeof card.fileMetadata?.height === "number") {
      file.height = card.fileMetadata.height;
    }
    if (typeof card.fileMetadata?.duration === "number") {
      file.duration = card.fileMetadata.duration;
    }
    serialized.file = file;
  }

  return serialized;
}

export interface ExportManifest {
  exportVersion: number;
  schemaVersion: number;
  appName: string;
  createdAt: DualTimestamp;
  expiresAt: DualTimestamp;
  retentionMs: number;
  counts: {
    cards: number;
    filesIncluded: number;
    filesOmitted: number;
  };
}

/** Build the manifest object embedded as manifest.json. */
export function buildManifest(args: {
  createdAtMs: number;
  expiresAtMs: number;
  cardCount: number;
  filesIncluded: number;
  filesOmitted: number;
}): ExportManifest {
  return {
    exportVersion: EXPORT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    appName: APP_NAME,
    createdAt: toDualTimestamp(args.createdAtMs),
    expiresAt: toDualTimestamp(args.expiresAtMs),
    retentionMs: EXPORT_RETENTION_MS,
    counts: {
      cards: args.cardCount,
      filesIncluded: args.filesIncluded,
      filesOmitted: args.filesOmitted,
    },
  };
}

export interface CapCheckResult {
  ok: boolean;
  reason?: "too_many_cards" | "too_large";
  cardCount: number;
  estimatedBytes: number;
}

/**
 * Estimate the artifact size from the active card set. Sums original file sizes
 * (the dominant contribution) plus a small per-card JSON allowance.
 */
export function estimateArtifactSize(
  cards: Array<{ fileMetadata?: { fileSize?: number } }>
): number {
  const PER_CARD_JSON_BYTES = 2 * 1024; // generous allowance for card JSON
  return cards.reduce((total, card) => {
    const fileSize = card.fileMetadata?.fileSize ?? 0;
    return total + fileSize + PER_CARD_JSON_BYTES;
  }, 0);
}

/**
 * Determine whether the export exceeds the V1 caps. Pure; callers decide how to
 * fail. Card count is checked first so the clearest reason wins.
 */
export function checkExportCaps(
  cards: Array<{ fileMetadata?: { fileSize?: number } }>
): CapCheckResult {
  const cardCount = cards.length;
  const estimatedBytes = estimateArtifactSize(cards);

  if (cardCount > MAX_EXPORT_CARDS) {
    return { ok: false, reason: "too_many_cards", cardCount, estimatedBytes };
  }
  if (estimatedBytes > MAX_EXPORT_BYTES) {
    return { ok: false, reason: "too_large", cardCount, estimatedBytes };
  }
  return { ok: true, cardCount, estimatedBytes };
}

/**
 * Weekly quota check. A new export is allowed when there is no successful
 * export within the rolling window. Failed/canceled jobs do not count and must
 * not be passed as `lastSuccessfulAtMs`.
 */
export function isWithinQuota(
  lastSuccessfulAtMs: number | undefined,
  nowMs: number
): boolean {
  if (lastSuccessfulAtMs === undefined) {
    return true;
  }
  return nowMs - lastSuccessfulAtMs >= EXPORT_QUOTA_WINDOW_MS;
}

/** Milliseconds remaining until the quota window resets (0 when allowed). */
export function quotaResetInMs(
  lastSuccessfulAtMs: number | undefined,
  nowMs: number
): number {
  if (lastSuccessfulAtMs === undefined) {
    return 0;
  }
  const remaining = lastSuccessfulAtMs + EXPORT_QUOTA_WINDOW_MS - nowMs;
  return remaining > 0 ? remaining : 0;
}

/** Compute the expiry timestamp for an artifact completed at `completedAtMs`. */
export function computeExpiry(completedAtMs: number): number {
  return completedAtMs + EXPORT_RETENTION_MS;
}

/** Whether a completed artifact has passed its expiry. */
export function isExpired(expiresAtMs: number | undefined, nowMs: number): boolean {
  if (expiresAtMs === undefined) {
    return false;
  }
  return nowMs >= expiresAtMs;
}
