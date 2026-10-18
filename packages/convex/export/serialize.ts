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
  completedAt?: number;
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
  sourceTitle?: string;
  sourceUrl?: string;
  tags?: string[];
  type: string;
  updatedAt: number;
  url?: string;
}

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
  /** When a link was marked read, watched, bought or done, if it was. */
  completedAt?: DualTimestamp;
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
  /** The page's title, beside `sourceUrl`, when it had one. */
  sourceTitle?: string;
  /** The page a text card was saved from. */
  sourceUrl?: string;
  tags: string[];
  type: string;
  updatedAt: DualTimestamp;
  url?: string;
}

export function isActiveCard(card: { isDeleted?: boolean }): boolean {
  return card.isDeleted !== true;
}

export function toDualTimestamp(epochMs: number): DualTimestamp {
  return {
    iso: new Date(epochMs).toISOString(),
    epochMs,
  };
}

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

export function buildFilePath(
  cardId: string,
  rawName: string | undefined
): string {
  return `${FILES_DIR}/${cardId}-${sanitizeFilename(rawName)}`;
}

const nonEmpty = (value: string | undefined): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

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
  if (typeof card.completedAt === "number") {
    serialized.completedAt = toDualTimestamp(card.completedAt);
  }
  if (typeof card.notes === "string" && card.notes.length > 0) {
    serialized.notes = card.notes;
  }
  const sourceUrl = nonEmpty(card.sourceUrl);
  if (sourceUrl !== undefined) {
    serialized.sourceUrl = sourceUrl;
    const sourceTitle = nonEmpty(card.sourceTitle);
    if (sourceTitle !== undefined) {
      serialized.sourceTitle = sourceTitle;
    }
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

export function estimateArtifactSize(
  cards: Array<{ fileMetadata?: { fileSize?: number } }>
): number {
  const PER_CARD_JSON_BYTES = 2 * 1024;
  return cards.reduce((total, card) => {
    const fileSize = card.fileMetadata?.fileSize ?? 0;
    return total + fileSize + PER_CARD_JSON_BYTES;
  }, 0);
}

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

export function isWithinQuota(
  lastSuccessfulAtMs: number | undefined,
  nowMs: number
): boolean {
  if (lastSuccessfulAtMs === undefined) {
    return true;
  }
  return nowMs - lastSuccessfulAtMs >= EXPORT_QUOTA_WINDOW_MS;
}

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

export function computeExpiry(completedAtMs: number): number {
  return completedAtMs + EXPORT_RETENTION_MS;
}

export function isExpired(
  expiresAtMs: number | undefined,
  nowMs: number
): boolean {
  if (expiresAtMs === undefined) {
    return false;
  }
  return nowMs >= expiresAtMs;
}
