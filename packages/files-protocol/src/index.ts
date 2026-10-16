export const FILES_PROTOCOL_VERSION = 1 as const;
export const FILES_PROCESSOR_VERSION = "2026-08-26.1" as const;
export const FILES_OP_PATH = "/__ops/v1" as const;
export const FILES_IMAGE_PATH = "/__images/v1" as const;
export const FILES_IMAGE_SOURCE_PATH = "/__image-source/v1" as const;

// Renditions are an allowlist: dimensions, crop, and quality stay
// server-controlled so clients can never request arbitrary transform
// combinations. `tiny` doubles as the loading placeholder and `compact`
// serves small/mobile cards; `grid` and `detail` keep their historical roles.
export const FILES_IMAGE_RENDITIONS = [
  "tiny",
  "compact",
  "grid",
  "detail",
] as const;
export type FilesImageRendition = (typeof FILES_IMAGE_RENDITIONS)[number];

export const isFilesImageRendition = (
  value: unknown
): value is FilesImageRendition =>
  typeof value === "string" &&
  (FILES_IMAGE_RENDITIONS as readonly string[]).includes(value);

export const FILES_UPLOAD_PATH = "/__upload/v1" as const;

/** Upper bound for single-file upload URL validity, enforced by the worker. */
export const FILES_UPLOAD_MAX_TTL_SECONDS = 15 * 60;

export const FILES_OPS = [
  "capabilities",
  "analyze-image",
  "abort-multipart",
  "build-export",
  "cleanup-stale-pending-uploads",
  "complete-multipart",
  "create-multipart",
  "freeze-object",
  "delete-object",
  "delete-objects",
  "extract-import-files",
  "finalize-image-upload",
  "finalize-upload",
  "generate-image-metadata",
  "generate-text-metadata",
  "generate-link-metadata",
  "head-object",
  "inspect",
  "list-objects",
  "index-import-source",
  "read-import-markdown",
  "render-pdf-thumbnail",
  "extract-video-frame",
  "capture-screenshot",
  "scrape-html",
  "probe-media",
  // Palette of an animated GIF from frames across it; stores nothing.
  "extract-animation-palette",
  // Waveform, media facts and transcript in one pass.
  "process-audio",
  // Downloads a remote preview asset through the fetcher Container straight
  // into R2; see ./remoteAsset.
  "store-remote-asset",
  // Fetches and scrapes a link's page through the fetcher Container, with a
  // Browser Run fallback; see ./linkPage.
  "fetch-link-page",
  // Card embeddings in Vectorize, one namespace per user; see ./embeddings.
  "embed-upsert",
  "vector-delete",
  "vector-get",
  "vector-query",
  "vector-similar",
  // Starts Cloudflare Workflow instances and queues object deletions; see
  // ./workflows.
  "dispatch",
] as const;

export type FilesOp = (typeof FILES_OPS)[number];

// Modes of the `inspect` op. `pdf` is additive: a Worker deployed before it
// rejects the mode with INVALID_INPUT, which Convex treats as "no text".
export const FILES_INSPECT_MODES = ["css", "pdf", "text", "zip"] as const;
export type FilesInspectMode = (typeof FILES_INSPECT_MODES)[number];

export const isFilesInspectMode = (value: unknown): value is FilesInspectMode =>
  typeof value === "string" &&
  (FILES_INSPECT_MODES as readonly string[]).includes(value);

export type FilesErrorCode =
  | "AI_CAPACITY"
  | "AI_INVALID_OUTPUT"
  | "AUTH_EXPIRED"
  | "AUTH_INVALID"
  | "CONFLICT"
  | "INTERNAL"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "PAYLOAD_TOO_LARGE"
  // Browser Run or the media renderer is missing, busy or failing; retry later.
  | "RENDERER_UNAVAILABLE"
  | "UNSUPPORTED";

export interface FilesErrorEnvelope {
  error: {
    code: FilesErrorCode;
    aiFacts?: import("./metadata").FilesAiGenerationFacts;
    message: string;
    requestId: string;
    retryable: boolean;
  };
  ok: false;
  version: typeof FILES_PROTOCOL_VERSION;
}

export interface FilesSuccessEnvelope<T> {
  data: T;
  ok: true;
  requestId: string;
  version: typeof FILES_PROTOCOL_VERSION;
}

export type FilesEnvelope<T> = FilesErrorEnvelope | FilesSuccessEnvelope<T>;

/** Trusted facts returned after an uploaded image has been verified and stored. */
export interface FilesFinalizeImageResult {
  content?: undefined;
  decodedFormat: string;
  destinationKey: string;
  height: number | null;
  sourceEtag: string;
  storedEtag: string;
  storedFileSize: number;
  storedMimeType?: string;
  width: number | null;
}

export interface FilesFinalizeImageParams {
  destinationKey: string;
  expectedEtag?: string;
  expectedSize?: number;
  sourceKey: string;
}

export interface FilesOpRequest<T = unknown> {
  op: FilesOp;
  params: T;
  version: typeof FILES_PROTOCOL_VERSION;
}

export const isFilesOp = (value: unknown): value is FilesOp =>
  typeof value === "string" && (FILES_OPS as readonly string[]).includes(value);

export const buildFilesOpSigningPayload = ({
  bodySha256,
  expiresAt,
  requestId,
}: {
  bodySha256: string;
  expiresAt: string;
  requestId: string;
}): string =>
  [
    "files-op",
    String(FILES_PROTOCOL_VERSION),
    requestId,
    expiresAt,
    bodySha256,
  ].join("\n");

export const buildMultipartPartSigningPayload = ({
  expiresAt,
  key,
  partNumber,
  uploadId,
  size = null,
}: {
  size?: number | null;
  expiresAt: string;
  key: string;
  partNumber: number;
  uploadId: string;
}): string =>
  [
    "multipart-part",
    String(FILES_PROTOCOL_VERSION),
    key,
    uploadId,
    String(partNumber),
    expiresAt,
    ...(size === null ? [] : [String(size)]),
  ].join("\n");

export const buildImageSigningPayload = ({
  expiresAt,
  key,
  rendition,
}: {
  expiresAt: string;
  key: string;
  rendition: FilesImageRendition;
}): string =>
  ["image", String(FILES_PROTOCOL_VERSION), rendition, key, expiresAt].join(
    "\n"
  );

/**
 * Signing payload for single-file PUT uploads. Binds the HTTP method, object
 * key, expiry, content type, and expected size into one HMAC. Size is bound
 * only when known ahead of time; server-generated media (screenshots,
 * thumbnails) signs with an empty size and relies on the worker's hard cap.
 * An empty contentType (no `ct` param) leaves the content type unbound: the
 * worker stores the request's validated Content-Type but the signature does
 * not cover it — used when the encoding is decided at generation time
 * (e.g. WebP-vs-JPEG video frames).
 */
export const buildUploadSigningPayload = ({
  contentType,
  expiresAt,
  key,
  method = "PUT",
  size = null,
}: {
  contentType: string;
  expiresAt: string;
  key: string;
  method?: string;
  size?: number | null;
}): string =>
  [
    "upload",
    String(FILES_PROTOCOL_VERSION),
    method,
    key,
    contentType,
    size === null ? "" : String(size),
    expiresAt,
  ].join("\n");

export const buildImageSourceSigningPayload = ({
  expiresAt,
  key,
}: {
  expiresAt: string;
  key: string;
}): string =>
  ["image-source", String(FILES_PROTOCOL_VERSION), key, expiresAt].join("\n");

export const FILES_TRANSCRIPTION_MODEL =
  "@cf/openai/whisper-large-v3-turbo" as const;
export const FILES_TRANSCRIPT_MAX_BYTES = 512 * 1024;
/**
 * Text the inspect op extracts from a document: at most this many characters
 * (UTF-8 bytes for the text and archive modes), from at most
 * FILES_PDF_TEXT_MAX_PAGES pages of a PDF. Teak stores it as the card's text.
 */
export const FILES_EXTRACTED_TEXT_MAX_CHARACTERS = 512 * 1024;
export const FILES_PDF_TEXT_MAX_PAGES = 500;

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
  "archive",
] as const;
export type FilesImportMode = (typeof FILES_IMPORT_MODES)[number];
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

export * from "./edgeIdentity";
export * from "./embeddings";
export * from "./linkPage";
export * from "./metadata";
export * from "./remoteAsset";
export * from "./rendering";
export * from "./storage";
export * from "./workflows";
