import type { FilesAiGenerationFacts } from "./metadata";
import type { FilesOp } from "./opTable";

export const FILES_PROTOCOL_VERSION = 1 as const;
export const FILES_PROCESSOR_VERSION = "2026-08-26.1" as const;
export const FILES_OP_PATH = "/__ops/v1" as const;
export const FILES_IMAGE_PATH = "/__images/v1" as const;
export const FILES_IMAGE_SOURCE_PATH = "/__image-source/v1" as const;

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

export const FILES_UPLOAD_MAX_TTL_SECONDS = 15 * 60;

/** Upper bound for a signed op request's validity, enforced by the worker. */
export const FILES_OP_MAX_TTL_SECONDS = 15 * 60;
/** Validity Convex gives each signed op request it mints. */
export const FILES_OP_TTL_SECONDS = 10 * 60;

/** What the `capabilities` op reports; the deploy readiness check reads it. */
export interface FilesCapabilities {
  ai: boolean;
  browser: boolean;
  crons: string[];
  dispatchItems: readonly string[];
  fetcher: boolean;
  images: boolean;
  importModes: readonly string[];
  maintenanceTasks: readonly string[];
  onboardingFiles: boolean;
  operations: readonly string[];
  renderer: boolean;
  rendererHealthy?: boolean;
  vectors: boolean;
  vectorTypes: boolean;
  workflows: boolean;
}

/** A Worker that doesn't know a mode answers INVALID_INPUT. */
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
  | "RATE_LIMITED"
  | "RENDERER_UNAVAILABLE"
  | "UNSUPPORTED";

export interface FilesErrorEnvelope {
  error: {
    code: FilesErrorCode;
    aiFacts?: FilesAiGenerationFacts;
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
