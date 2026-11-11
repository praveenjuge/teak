export * from "./ops";

export const FILES_TRANSCRIPTION_MODEL =
  "@cf/openai/whisper-large-v3-turbo" as const;
export const FILES_TRANSCRIPT_MAX_BYTES = 512 * 1024;
export const FILES_EXTRACTED_TEXT_MAX_CHARACTERS = 512 * 1024;
export const FILES_EXTRACTED_TEXT_MAX_BYTES = 512 * 1024;
export const FILES_PDF_TEXT_MAX_PAGES = 500;

export const FILES_SCANNED_PDF_MIN_CHARS_PER_PAGE = 20;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/gu;

export const isScannedPdf = ({
  pageCount,
  text,
}: {
  pageCount?: number | null;
  text: string;
}): boolean => {
  if (!(typeof pageCount === "number" && pageCount > 0)) {
    return false;
  }
  const pages = Math.min(pageCount, FILES_PDF_TEXT_MAX_PAGES);
  const chars = text.match(LETTER_OR_DIGIT)?.length ?? 0;
  return chars / pages < FILES_SCANNED_PDF_MIN_CHARS_PER_PAGE;
};

export const FILES_IMPORT_PAGE_BYTES = 4 * 1024 * 1024;
export const FILES_IMPORT_PAGE_ITEMS = 100;
export const FILES_IMPORT_MODES = [
  "bookmarks",
  "pocket",
  "raindrop",
  "instapaper",
  "readwise",
  "omnivore",
  "linkwarden",
  "mymind",
  "onetab",
  "csv",
  "links",
  "archive",
] as const;
export type FilesImportMode = (typeof FILES_IMPORT_MODES)[number];
/** The most cards one import creates, whatever its source. */
export const MAX_IMPORT_CARDS = 10_000;
/** The largest single file an import reads, on its own or out of an archive. */
export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;
/** The largest archive an import opens, packed or unpacked. */
export const MAX_IMPORT_ARCHIVE_BYTES = 5 * 1024 ** 3;
export interface FilesImportIndexParams {
  cursor?: number;
  expectedSize: number;
  mode: FilesImportMode;
  sourceEtag?: string;
  sourceKey: string;
}
export interface FilesImportIndexItem {
  card?: unknown;
  error?: string;
  file?: { path: string; uncompressedSize: number };
  label?: string;
  sourceIndex: number;
}
export interface FilesImportIndexResult {
  items: FilesImportIndexItem[];
  nextCursor: number | null;
  sourceEtag: string;
  total: number;
}
export interface FilesImportMarkdownParams {
  path: string;
  sourceEtag: string;
  sourceKey: string;
}
export type FilesImportMarkdownResult =
  | { content: string; type: "text" }
  | {
      status: "failed";
      failureCode: "CONTENT_TOO_LARGE" | "INVALID_UTF8" | "INVALID_ITEM";
      failureReason: string;
    };

export * from "./article";
export * from "./cardProcessing";
export * from "./decisions";
export * from "./edgeIdentity";
export * from "./embeddings";
export * from "./inboundEmail";
export * from "./inspect";
export * from "./linkCheck";
export * from "./linkedPdf";
export * from "./linkPage";
export * from "./mediaTypes";
export * from "./metadata";
export * from "./onboarding";
export * from "./opTable";
export * from "./outcome";
export * from "./pageArchive";
export * from "./remoteAsset";
export * from "./rendering";
export * from "./signing";
export * from "./staticHtml";
export * from "./storage";
export * from "./workflows";
