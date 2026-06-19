import { sanitizeExternalUrl } from "../shared/utils/safeUrl";
import { MAX_IMPORT_CARDS, MAX_IMPORT_FILE_BYTES } from "./constants";

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

export interface ImportCardInput {
  colors?: Array<{ hex: string; name?: string }>;
  content: string;
  createdAt?: number;
  file?: ImportFileInput;
  isFavorited?: boolean;
  notes?: string;
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
  if (content.length > 100_000) {
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
    colors: rawColors as ImportCardInput["colors"],
    createdAt: parseImportedTimestamp(value.createdAt),
    file,
  };
}

export function assertImportCardCount(count: number): void {
  if (count > MAX_IMPORT_CARDS) {
    throw new Error("Archive exceeds 10,000 cards");
  }
}
