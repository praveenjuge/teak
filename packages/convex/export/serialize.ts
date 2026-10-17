/**
 * The exported card JSON keeps only active cards and an allow-list of fields:
 * the visible AI tags and summary, the title and folder names are in (schema
 * v2); transcripts, scraped link metadata, account data, source metadata and
 * thumbnails/screenshots/preview media stay out.
 */

import { isHiddenTagList } from "../shared/tags";
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
  aiSummary?: string;
  aiTags?: string[];
  colors?: Array<{
    hex: string;
    name?: string;
    rgb?: { r: number; g: number; b: number };
    hsl?: { h: number; s: number; l: number };
  }>;
  content?: string;
  createdAt: number;
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
  folderIds?: string[];
  isArchived?: boolean;
  isDeleted?: boolean;
  isFavorited?: boolean;
  isHidden?: boolean;
  metadataTitle?: string;
  notes?: string;
  tags?: string[];
  type: string;
  updatedAt: number;
  url?: string;
}

/** A timestamp expressed as both ISO 8601 and epoch milliseconds. */
export interface DualTimestamp {
  epochMs: number;
  iso: string;
}

export interface SerializedCardFile {
  duration?: number;
  fileName: string;
  fileSize?: number;
  height?: number;
  mimeType?: string;
  /** Archive-relative path, e.g. files/<cardId>-<name>. Present only when included. */
  path: string;
  width?: number;
}

export interface SerializedCard {
  /** Present when AI wrote a summary (schema v2). */
  aiSummary?: string;
  /** Tags AI added, apart from the user's own `tags` (schema v2). */
  aiTags: string[];
  colors?: Array<{ hex: string; name?: string }>;
  content: string;
  createdAt: DualTimestamp;
  file?: SerializedCardFile;
  /** Names of the folders the card is in, in the card's order (schema v2). */
  folders: string[];
  id: string;
  isArchived: boolean;
  isFavorited: boolean;
  /** A reserved tag (`secret`, `hidden`) hides it in Teak's lists. */
  isHidden: boolean;
  /** The card's title, when it has one (schema v2). */
  metadataTitle?: string;
  notes?: string;
  tags: string[];
  type: string;
  updatedAt: DualTimestamp;
  url?: string;
}

/** A card is exportable when it has not been soft-deleted. */
export function isActiveCard(card: { isDeleted?: boolean }): boolean {
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
export function buildFilePath(
  cardId: string,
  rawName: string | undefined
): string {
  return `${FILES_DIR}/${cardId}-${sanitizeFilename(rawName)}`;
}

const nonEmpty = (value: string | undefined): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

/**
 * Serialize a single card to its user-facing export shape.
 *
 * `includeFile` indicates whether the original file was successfully read and
 * placed into the archive. When false (missing file omitted after retry), the
 * card is still serialized but without a `file` entry. `folderNames` maps the
 * user's folder ids to names; ids missing from it (a folder being deleted)
 * are left out.
 */
export function serializeCard(
  card: ExportableCard,
  options: {
    includeFile: boolean;
    folderNames?: ReadonlyMap<string, string>;
  } = { includeFile: false }
): SerializedCard {
  const folders: string[] = [];
  for (const id of card.folderIds ?? []) {
    const name = options.folderNames?.get(id);
    if (name !== undefined && !folders.includes(name)) {
      folders.push(name);
    }
  }
  const serialized: SerializedCard = {
    id: card._id,
    type: card.type,
    content: card.content ?? "",
    tags: Array.isArray(card.tags) ? [...card.tags] : [],
    aiTags: Array.isArray(card.aiTags) ? [...card.aiTags] : [],
    folders,
    isFavorited: card.isFavorited === true,
    isArchived: card.isArchived === true,
    isHidden: card.isHidden === true || isHiddenTagList(card.tags),
    createdAt: toDualTimestamp(card.createdAt),
    updatedAt: toDualTimestamp(card.updatedAt),
  };

  if (typeof card.url === "string" && card.url.length > 0) {
    serialized.url = card.url;
  }
  if (typeof card.notes === "string" && card.notes.length > 0) {
    serialized.notes = card.notes;
  }
  const title = nonEmpty(card.metadataTitle);
  if (title !== undefined) {
    serialized.metadataTitle = title;
  }
  const summary = nonEmpty(card.aiSummary);
  if (summary !== undefined) {
    serialized.aiSummary = summary;
  }

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
  appName: string;
  counts: {
    cards: number;
    filesIncluded: number;
    filesOmitted: number;
  };
  createdAt: DualTimestamp;
  expiresAt: DualTimestamp;
  exportVersion: number;
  retentionMs: number;
  schemaVersion: number;
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
  cardCount: number;
  estimatedBytes: number;
  ok: boolean;
  reason?: "too_many_cards" | "too_large";
}

/**
 * Estimate the artifact size from the active card set. Sums original file sizes
 * (the dominant contribution) plus a small per-card JSON allowance.
 */
export function estimateArtifactSize(
  cards: Array<{ fileMetadata?: { fileSize?: number } }>
): number {
  const PER_CARD_JSON_BYTES = 2 * 1024;
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
export function isExpired(
  expiresAtMs: number | undefined,
  nowMs: number
): boolean {
  if (expiresAtMs === undefined) {
    return false;
  }
  return nowMs >= expiresAtMs;
}
