import { MAX_CARD_TITLE_LENGTH } from "../shared/cardTitle";
import {
  explainInvalidFolderName,
  MAX_FOLDERS_PER_CARD,
  normalizeFolderName,
} from "../shared/folders";
import {
  highlightLength,
  MAX_HIGHLIGHT_NOTE_CHARS,
  MAX_HIGHLIGHT_QUOTE_CHARS,
  MAX_HIGHLIGHTS_PER_CARD,
} from "../shared/highlights/constants";
import { IMPORT_SOURCES } from "../shared/importSources";
import { validateMarkdownContent } from "../shared/markdown";
import { sanitizeExternalUrl } from "../shared/utils/safeUrl";
import {
  type ImportMode,
  MAX_IMPORT_CARDS,
  MAX_IMPORT_FILE_BYTES,
} from "./constants";

export const IMPORT_CARD_TYPES = [
  "text",
  "link",
  "image",
  "video",
  "audio",
  "document",
  "palette",
  "quote",
] as const;

export type ImportCardType = (typeof IMPORT_CARD_TYPES)[number];

export interface ImportFileInput {
  duration?: number;
  fileName: string;
  fileSize?: number;
  height?: number;
  mimeType?: string;
  path: string;
  width?: number;
}

export interface ImportHighlightInput {
  note?: string;
  quote: string;
}

export interface ImportCardInput {
  colors?: Array<{ hex: string; name?: string }>;
  completedAt?: number;
  content: string;
  createdAt?: number;
  file?: ImportFileInput;
  folders?: string[];
  /**
   * Passages highlighted in the source, for a link: they become highlights,
   * found in the article once Teak has it.
   */
  highlights?: ImportHighlightInput[];
  isArchived?: boolean;
  isFavorited?: boolean;
  metadataTitle?: string;
  notes?: string;
  /** When the card was last saved; exports before re-saves have none. */
  savedAt?: number;
  tags?: string[];
  type: ImportCardType;
  url?: string;
}

const FILE_TYPES = new Set<ImportCardType>([
  "image",
  "video",
  "audio",
  "document",
]);

export function isSafeArchivePath(path: string): boolean {
  if (
    !path ||
    path.includes("\\") ||
    path.startsWith("/") ||
    path.includes("\0")
  ) {
    return false;
  }
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  const segments = normalized.split("/");
  return !segments.some((segment) => segment === ".." || segment === "");
}

export function parseImportedTimestamp(value: unknown): number | undefined {
  const candidate =
    typeof value === "object" && value !== null && "epochMs" in value
      ? (value as { epochMs?: unknown }).epochMs
      : value;
  const timestamp =
    typeof candidate === "string" ? Date.parse(candidate) : candidate;
  if (
    typeof timestamp !== "number" ||
    !Number.isFinite(timestamp) ||
    timestamp < 0 ||
    timestamp > Date.now() + 5 * 60 * 1000
  ) {
    return;
  }
  return Math.floor(timestamp);
}

export function mimeMatchesType(type: ImportCardType, mime: string): boolean {
  if (type === "image") {
    return mime.startsWith("image/");
  }
  if (type === "video") {
    return mime.startsWith("video/");
  }
  if (type === "audio") {
    return mime.startsWith("audio/");
  }
  if (type !== "document") {
    return false;
  }
  return (
    mime === "application/pdf" ||
    mime.startsWith("text/") ||
    mime === "application/msword" ||
    mime.startsWith("application/vnd.openxmlformats-officedocument")
  );
}

function validNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function importFolderNames(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) {
    return;
  }
  if (!Array.isArray(raw)) {
    throw new Error("Card folders are invalid");
  }
  const names: string[] = [];
  const keys = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string" || explainInvalidFolderName(value)) {
      continue;
    }
    const name = normalizeFolderName(value);
    const key = name.toLowerCase();
    if (keys.has(key)) {
      continue;
    }
    keys.add(key);
    names.push(name);
    if (names.length === MAX_FOLDERS_PER_CARD) {
      break;
    }
  }
  return names.length ? names : undefined;
}

/**
 * `text` trimmed, then cut to `max` characters. Overlapping highlights merge
 * into one that can run past the quote limit, and Teak's export writes it as
 * it is: the passage's start still finds it in the article.
 */
const clipHighlightText = (text: string, max: number): string => {
  const trimmed = text.trim();
  return highlightLength(trimmed) > max
    ? Array.from(trimmed).slice(0, max).join("").trim()
    : trimmed;
};

/**
 * A link's highlights: at most 200, each a quote of at most 5,000 characters
 * with a note of at most 2,000, longer ones cut to fit. Empty quotes are
 * skipped.
 */
export function importHighlights(
  raw: unknown
): ImportHighlightInput[] | undefined {
  if (raw === undefined || raw === null) {
    return;
  }
  if (!Array.isArray(raw) || raw.length > MAX_HIGHLIGHTS_PER_CARD) {
    throw new Error("Card highlights are invalid");
  }
  const highlights: ImportHighlightInput[] = [];
  for (const value of raw) {
    const entry =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : null;
    if (
      typeof entry?.quote !== "string" ||
      (entry.note !== undefined &&
        entry.note !== null &&
        typeof entry.note !== "string")
    ) {
      throw new Error("Card highlights are invalid");
    }
    const quote = clipHighlightText(entry.quote, MAX_HIGHLIGHT_QUOTE_CHARS);
    const note =
      typeof entry.note === "string"
        ? clipHighlightText(entry.note, MAX_HIGHLIGHT_NOTE_CHARS)
        : "";
    if (quote) {
      highlights.push(note ? { quote, note } : { quote });
    }
  }
  return highlights.length ? highlights : undefined;
}

function importTitle(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return;
  }
  let title = raw.trim().slice(0, MAX_CARD_TITLE_LENGTH);
  if (/[\uD800-\uDBFF]$/.test(title)) {
    title = title.slice(0, -1);
  }
  return title.trim() || undefined;
}

export function validateImportCard(raw: unknown): ImportCardInput {
  if (!raw || typeof raw !== "object") {
    throw new Error("Card must be an object");
  }
  const value = raw as Record<string, unknown>;
  if (!IMPORT_CARD_TYPES.includes(value.type as ImportCardType)) {
    throw new Error("Unsupported card type");
  }
  const type = value.type as ImportCardType;
  const content = typeof value.content === "string" ? value.content : "";
  if (type === "text") {
    validateMarkdownContent(content);
  } else if (content.length > 100_000) {
    throw new Error("Card content is too long");
  }
  const notes = typeof value.notes === "string" ? value.notes : undefined;
  if (notes && notes.length > 100_000) {
    throw new Error("Card notes are too long");
  }
  const rawTags = value.tags;
  if (
    rawTags !== undefined &&
    (!Array.isArray(rawTags) ||
      rawTags.length > 50 ||
      rawTags.some(
        (tag) => typeof tag !== "string" || !tag.trim() || tag.length > 64
      ))
  ) {
    throw new Error("Card tags are invalid");
  }
  const rawUrl = typeof value.url === "string" ? value.url : undefined;
  const url = sanitizeExternalUrl(rawUrl);
  if (rawUrl?.trim() && !url) {
    throw new Error("Card URL is unsafe");
  }
  const rawColors = value.colors;
  if (
    rawColors !== undefined &&
    (!Array.isArray(rawColors) ||
      rawColors.length > 32 ||
      rawColors.some(
        (color) =>
          !color ||
          typeof color !== "object" ||
          typeof (color as { hex?: unknown }).hex !== "string" ||
          !/^#[0-9a-f]{6}$/i.test((color as { hex: string }).hex)
      ))
  ) {
    throw new Error("Card colors are invalid");
  }

  let file: ImportFileInput | undefined;
  if (value.file !== undefined) {
    if (
      !(FILE_TYPES.has(type) && value.file) ||
      typeof value.file !== "object"
    ) {
      throw new Error("File metadata does not match the card type");
    }
    const rawFile = value.file as Record<string, unknown>;
    const path = typeof rawFile.path === "string" ? rawFile.path : "";
    const fileName =
      typeof rawFile.fileName === "string" ? rawFile.fileName : "";
    const fileSize = validNumber(rawFile.fileSize);
    const mimeType =
      typeof rawFile.mimeType === "string" ? rawFile.mimeType : undefined;
    if (!(path.startsWith("files/") && isSafeArchivePath(path))) {
      throw new Error("File path must be a safe path under files/");
    }
    if (!fileName || fileName.length > 255) {
      throw new Error("Filename is invalid");
    }
    if (fileSize !== undefined && fileSize > MAX_IMPORT_FILE_BYTES) {
      throw new Error("File exceeds the 20 MiB limit");
    }
    if (!(mimeType && mimeMatchesType(type, mimeType))) {
      throw new Error("File MIME type does not match the card type");
    }
    file = {
      path,
      fileName,
      fileSize,
      mimeType,
      duration: validNumber(rawFile.duration),
      width: validNumber(rawFile.width),
      height: validNumber(rawFile.height),
    };
  } else if (FILE_TYPES.has(type)) {
    throw new Error("File card is missing its local file");
  }

  return {
    type,
    content,
    url,
    tags: Array.isArray(rawTags)
      ? [...new Set(rawTags.map((tag) => String(tag).trim()))]
      : undefined,
    notes,
    isFavorited: value.isFavorited === true,
    isArchived: value.isArchived === true ? true : undefined,
    metadataTitle: importTitle(value.metadataTitle),
    folders: importFolderNames(value.folders),
    highlights:
      type === "link" ? importHighlights(value.highlights) : undefined,
    colors: rawColors as ImportCardInput["colors"],
    createdAt: parseImportedTimestamp(value.createdAt),
    savedAt: parseImportedTimestamp(value.savedAt),
    completedAt:
      type === "link" ? parseImportedTimestamp(value.completedAt) : undefined,
    file,
  };
}

export function assertImportCardCount(count: number, mode: ImportMode): void {
  if (count <= MAX_IMPORT_CARDS) {
    return;
  }
  if (mode === "bookmarks") {
    throw new Error("Bookmark file exceeds 10,000 bookmarks");
  }
  if (mode === "archive") {
    throw new Error("Archive exceeds 10,000 cards");
  }
  throw new Error(`${IMPORT_SOURCES[mode].title} file exceeds 10,000 items`);
}
