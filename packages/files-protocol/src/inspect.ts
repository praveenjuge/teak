import type { FilesInspectMode } from "./index";
import { FILES_UPLOAD_MAX_BYTES } from "./storage";

export const FILES_INSPECT_MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
export const FILES_INSPECT_MAX_SOURCE_BYTES = 2 * 1024 * 1024;

export interface FilesInspectParams {
  formatId: string;
  maxBytes: number;
  mode: FilesInspectMode;
  rtf?: boolean;
  sourceKey: string;
}

export interface FilesInspectResult {
  facts?: Record<string, number>;
  text?: string;
}

export interface ExtractedDocumentText {
  pageCount?: number;
  text: string;
}

const TEXT_FORMAT_KINDS = ["markdown", "source", "text", "tokens"];
const ARCHIVE_FORMAT_IDS = ["word", "powerpoint"];

/**
 * A document's text, with the PDF's page count when it reported one. Empty
 * text for formats without text, scans, and documents the op declines.
 */
export const extractDocumentFileText = async (
  inspect: (
    params: FilesInspectParams
  ) => Promise<{ kind: "ok"; data: FilesInspectResult } | { kind: "fallback" }>,
  sourceKey: string,
  format: { id: string; kind: string },
  card: { fileMetadata?: { kind?: string } | null }
): Promise<ExtractedDocumentText> => {
  const archive = ARCHIVE_FORMAT_IDS.includes(format.id);
  const pdf = format.kind === "pdf";
  const text = TEXT_FORMAT_KINDS.includes(format.kind);
  if (!(archive || pdf || text)) {
    return { text: "" };
  }
  let mode: FilesInspectMode = "text";
  let maxBytes = FILES_INSPECT_MAX_SOURCE_BYTES;
  if (archive) {
    mode = "zip";
    maxBytes = FILES_INSPECT_MAX_ARCHIVE_BYTES;
  } else if (pdf) {
    mode = "pdf";
    maxBytes = FILES_UPLOAD_MAX_BYTES;
  }
  const outcome = await inspect({
    formatId: format.id,
    maxBytes,
    mode,
    rtf: text && card.fileMetadata?.kind === "text" && format.id === "rtf",
    sourceKey,
  });
  if (outcome.kind !== "ok") {
    return { text: "" };
  }
  const pageCount = outcome.data.facts?.pageCount;
  return {
    text: outcome.data.text ?? "",
    ...(typeof pageCount === "number" && { pageCount }),
  };
};

/** A link's preview image (og:image), then its screenshot. */
export const linkOcrSourceKeys = (
  preview:
    | { imageStorageKey?: string; screenshotStorageKey?: string }
    | null
    | undefined
): string[] =>
  [preview?.imageStorageKey, preview?.screenshotStorageKey].filter(
    (key): key is string => Boolean(key)
  );
