import type { FilesAiGenerationFacts } from "./metadata";

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

/** Ops Convex sends to the Worker over HTTPS, at `FILES_OP_PATH`. */
export const FILES_NETWORK_OPS = [
  "capabilities",
  "abort-multipart",
  "check-link",
  "complete-multipart",
  "create-multipart",
  "delete-object",
  "delete-objects",
  "dispatch",
  "embed-upsert",
  "extract-image-text",
  "finalize-image-upload",
  "finalize-upload",
  "inspect",
  "score-relevance",
  "store-linked-pdf",
  "store-onboarding-files",
  "vector-delete",
  "vector-query",
  "vector-similar",
] as const;

/**
 * Ops only the Worker's own workflows, queues and crons run, in process.
 * The network route refuses them.
 */
export const FILES_WORKER_OPS = [
  "analyze-image",
  "archive-page",
  "build-export",
  "capture-screenshot",
  "cleanup-stale-pending-uploads",
  "decide-card-type",
  "decide-link-category",
  "decide-visual-styles",
  "extract-animation-palette",
  "extract-article",
  "extract-import-files",
  "extract-video-frame",
  "fetch-link-page",
  "freeze-object",
  "generate-image-metadata",
  "generate-link-metadata",
  "generate-text-metadata",
  "head-object",
  "index-import-source",
  "list-objects",
  "ocr-pdf-pages",
  "probe-media",
  "process-audio",
  "read-import-markdown",
  "render-pdf-thumbnail",
  "store-remote-asset",
] as const;

export const FILES_OPS = [...FILES_NETWORK_OPS, ...FILES_WORKER_OPS] as const;

export type FilesNetworkOp = (typeof FILES_NETWORK_OPS)[number];
export type FilesOp = (typeof FILES_OPS)[number];

export const isFilesNetworkOp = (value: unknown): value is FilesNetworkOp =>
  typeof value === "string" &&
  (FILES_NETWORK_OPS as readonly string[]).includes(value);

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
