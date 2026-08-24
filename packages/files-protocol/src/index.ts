export const FILES_PROTOCOL_VERSION = 1 as const;
export const FILES_PROCESSOR_VERSION = "2026-08-24.1" as const;
export const FILES_OP_PATH = "/__ops/v1" as const;

export const FILES_OPS = [
  "abort-multipart",
  "build-export",
  "complete-multipart",
  "create-multipart",
  "delete-object",
  "extract-import-files",
  "finalize-upload",
  "inspect",
  "process-image",
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
