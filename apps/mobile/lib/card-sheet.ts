import type { Doc } from "@teak/convex/_generated/dataModel";
import { getMobileFilePreview } from "./files";

export type CardSheetDetail = Doc<"cards"> & {
  detailUrl?: string;
  fileUrl?: string;
  screenshotUrl?: string;
  thumbnailUrl?: string;
};

export interface SheetDetailRow {
  label: string;
  value: string;
}

export type SheetShareTarget =
  | { kind: "none" }
  | { item: string; kind: "item"; subject?: string }
  | { fileName: string; kind: "file"; url: string };

const WWW_PREFIX_REGEX = /^www\./;

const TYPE_LABELS: Record<CardSheetDetail["type"], string> = {
  audio: "Audio",
  document: "Document",
  image: "Image",
  link: "Link",
  palette: "Palette",
  quote: "Quote",
  text: "Text",
  video: "Video",
};

const SIZE_UNITS = ["B", "KB", "MB", "GB"];

export const formatFileSize = (bytes: number): string => {
  if (!(bytes > 0)) {
    return "0 B";
  }
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    SIZE_UNITS.length - 1
  );
  const scaled = bytes / 1024 ** exponent;
  const rounded =
    exponent === 0
      ? String(Math.round(scaled))
      : String(Math.round(scaled * 10) / 10);
  return `${rounded} ${SIZE_UNITS[exponent]}`;
};

const formatDuration = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = String(total % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
};

export const formatSheetTimestamp = (value: number): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

/**
 * Decode a URL path segment into a readable filename. Signed rendition
 * URLs carry the whole encoded storage key as one segment, so decoding
 * plus basename extraction turns `users%2F…%2Fuuid-photo.heic` back into
 * `uuid-photo.heic`.
 */
const decodeUrlSegment = (segment: string): string => {
  try {
    const decoded = decodeURIComponent(segment);
    return decoded.split("/").filter(Boolean).pop() ?? decoded;
  } catch {
    return segment;
  }
};

export const buildDownloadFileName = (
  url?: string | null,
  fallback?: string
): string => {
  if (fallback) {
    return fallback;
  }

  if (url) {
    try {
      const lastSegment = new URL(url).pathname
        .split("/")
        .filter(Boolean)
        .pop();
      if (lastSegment) {
        return decodeUrlSegment(lastSegment);
      }
    } catch {
      // Ignore parse errors and fall through to the generated name.
    }
  }

  return `download-${Date.now()}`;
};

const getLinkHostname = (url?: string): string | null => {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).hostname.replace(WWW_PREFIX_REGEX, "");
  } catch {
    return null;
  }
};

export const getSheetDetailRows = (card: CardSheetDetail): SheetDetailRow[] => {
  const rows: SheetDetailRow[] = [
    { label: "Type", value: TYPE_LABELS[card.type] },
  ];
  const file = card.fileMetadata;

  if (card.type === "link") {
    const hostname = getLinkHostname(card.url);
    if (hostname) {
      rows.push({ label: "Website", value: hostname });
    }
  }
  if (file?.fileName) {
    rows.push({ label: "File", value: file.fileName });
  }
  if (file?.mimeType) {
    rows.push({ label: "Format", value: file.mimeType });
  }
  if (typeof file?.fileSize === "number") {
    rows.push({ label: "Size", value: formatFileSize(file.fileSize) });
  }
  if (typeof file?.width === "number" && typeof file?.height === "number") {
    rows.push({ label: "Dimensions", value: `${file.width} × ${file.height}` });
  }
  if (typeof file?.duration === "number") {
    rows.push({ label: "Duration", value: formatDuration(file.duration) });
  }

  const preview = getMobileFilePreview({
    fileKind: file?.kind,
    fileLanguage: file?.language,
    fileName: file?.fileName,
    detailUrl: card.detailUrl,
    fileUrl: card.fileUrl,
    mimeType: file?.mimeType,
    preview: file?.preview,
    screenshotUrl: card.screenshotUrl,
    thumbnailUrl: card.thumbnailUrl,
  });
  const typeLabel = TYPE_LABELS[card.type].toLowerCase();
  const facts = preview.facts.filter(
    (fact) => fact.toLowerCase() !== typeLabel
  );
  if (facts.length > 0) {
    rows.push({ label: "Details", value: facts.join(" · ") });
  }

  const description = card.metadataDescription?.trim();
  if (description) {
    rows.push({ label: "Description", value: description });
  }

  return rows;
};

export const getSheetCopyText = (card: CardSheetDetail): string | null => {
  const content = card.content?.trim();

  switch (card.type) {
    case "link":
      return card.url?.trim() || content || null;
    case "palette": {
      const hexes =
        card.colors?.map((color) => color.hex).filter(Boolean) ?? [];
      return hexes.length > 0 ? hexes.join(", ") : null;
    }
    default:
      return content || null;
  }
};

export const getSheetShareTarget = (
  card: CardSheetDetail
): SheetShareTarget => {
  switch (card.type) {
    case "link": {
      const url = card.url?.trim();
      if (!url) {
        return { kind: "none" };
      }
      return {
        item: url,
        kind: "item",
        ...(card.metadataTitle ? { subject: card.metadataTitle } : {}),
      };
    }
    case "text":
    case "quote": {
      const content = card.content?.trim();
      return content ? { item: content, kind: "item" } : { kind: "none" };
    }
    case "palette": {
      const copyText = getSheetCopyText(card);
      return copyText ? { item: copyText, kind: "item" } : { kind: "none" };
    }
    case "image": {
      // Thumbnails and screenshots are still images, so they stay valid
      // shares when the original file URL is missing. Fallback renditions
      // are named from their own URL: the original filename may describe
      // different bytes (e.g. photo.heic for a JPEG thumbnail).
      const url =
        card.fileUrl ?? card.thumbnailUrl ?? card.screenshotUrl ?? null;
      if (!url) {
        return { kind: "none" };
      }
      return {
        fileName:
          url === card.fileUrl
            ? buildDownloadFileName(url, card.fileMetadata?.fileName)
            : buildDownloadFileName(url),
        kind: "file",
        url,
      };
    }
    default: {
      // Video, audio, and documents share only the original file: a
      // thumbnail served under the original extension and MIME type
      // would arrive as corrupt bytes.
      const url = card.fileUrl ?? null;
      if (!url) {
        return { kind: "none" };
      }
      return {
        fileName: buildDownloadFileName(url, card.fileMetadata?.fileName),
        kind: "file",
        url,
      };
    }
  }
};
