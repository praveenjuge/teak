export const FILES_PROTOCOL_VERSION = 1 as const;
export const FILES_PROCESSOR_VERSION = "2026-08-24.1" as const;
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
  "analyze-image",
  // Additive alias of analyze-image; both are accepted so Worker and Convex
  // deployments can overlap safely within protocol version 1.
  "analyze-image-content",
  "abort-multipart",
  "build-export",
  "complete-multipart",
  "create-multipart",
  "delete-object",
  "delete-objects",
  "extract-import-files",
  "finalize-image-upload",
  "finalize-upload",
  "generate-image-metadata",
  "head-object",
  "inspect",
  "list-objects",
] as const;

export type FilesOp = (typeof FILES_OPS)[number];

export type FilesErrorCode =
  | "AUTH_EXPIRED"
  | "AUTH_INVALID"
  | "CONFLICT"
  | "INTERNAL"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED";

export interface FilesErrorEnvelope {
  error: {
    code: FilesErrorCode;
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
}: {
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
