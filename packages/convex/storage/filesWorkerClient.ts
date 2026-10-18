import {
  buildFilesOpSigningPayload,
  buildMultipartPartSigningPayload,
  buildUploadSigningPayload,
  FILES_OP_PATH,
  FILES_OP_TTL_SECONDS,
  FILES_PROTOCOL_VERSION,
  FILES_UPLOAD_MAX_TTL_SECONDS,
  FILES_UPLOAD_PATH,
  type FilesEnvelope,
  type FilesErrorCode,
  type FilesFinalizeImageResult,
  type FilesInspectMode,
  type FilesOp,
  type FilesOpRequest,
  isFilesInspectMode,
  readFilesAiGenerationFacts,
} from "@teak/files-protocol";
import { env } from "../_generated/server";
import { SAFE_FETCH_MAX_DURATION_MS } from "../linkMetadata/ssrf";
import { assertR2KeyInNamespace, hmacSha256Hex, sha256Hex } from "./r2Keys";

export const STORE_LINKED_PDF_TIMEOUT_MS = 150_000;

type OpTimeoutKey = FilesOp | `inspect:${FilesInspectMode}`;

const OP_TIMEOUT_MS: Partial<Record<OpTimeoutKey, number>> = {
  "abort-multipart": 90_000,
  "capture-screenshot": 90_000,
  "delete-objects": 90_000,
  "extract-video-frame": 90_000,
  "extract-image-text": 120_000,
  "fetch-link-page": 300_000,
  "freeze-object": 90_000,
  "generate-image-metadata": 120_000,
  "generate-link-metadata": 90_000,
  "generate-text-metadata": 90_000,
  "inspect:pdf": 90_000,
  "ocr-pdf-pages": 240_000,
  "probe-media": 90_000,
  "process-audio": 300_000,
  "render-pdf-thumbnail": 90_000,
  "scrape-html": 90_000,
  "embed-upsert": 60_000,
  "vector-delete": 30_000,
  "vector-get": 30_000,
  "vector-query": 30_000,
  "vector-similar": 30_000,
  "store-remote-asset": SAFE_FETCH_MAX_DURATION_MS + 60_000,
  "store-linked-pdf": STORE_LINKED_PDF_TIMEOUT_MS,
};

const opTimeoutMs = (spec: {
  op: FilesOp;
  params: Record<string, unknown>;
}): number | undefined => {
  const key: OpTimeoutKey =
    spec.op === "inspect" && isFilesInspectMode(spec.params.mode)
      ? `inspect:${spec.params.mode}`
      : spec.op;
  return OP_TIMEOUT_MS[key];
};

export const isFilesWorkerConfigured = (): boolean =>
  Boolean(env.FILES_BASE && env.FILES_SIGNING_SECRET);

export interface SignedUploadUrl {
  expiresAt: number;
  key: string;
  url: string;
}

export const buildSignedWorkerUploadUrl = async (
  {
    contentType,
    key,
    size = null,
    ttlSeconds = 10 * 60,
  }: {
    contentType: string | null;
    key: string;
    size?: number | null;
    ttlSeconds?: number;
  },
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<SignedUploadUrl> => {
  const base = env.FILES_BASE;
  const secret = env.FILES_SIGNING_SECRET;
  if (!(base && secret)) {
    throw new Error("files_worker_not_configured");
  }
  if (
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds <= 0 ||
    ttlSeconds > FILES_UPLOAD_MAX_TTL_SECONDS
  ) {
    throw new Error("invalid_upload_ttl");
  }
  assertR2KeyInNamespace(key);
  const expiresAtNumber = nowSeconds + ttlSeconds;
  const expiresAt = String(expiresAtNumber);
  const signature = await hmacSha256Hex(
    secret,
    buildUploadSigningPayload({
      contentType: contentType ?? "",
      expiresAt,
      key,
      size,
    })
  );
  const url = new URL(
    `${base.replace(/\/+$/, "")}${FILES_UPLOAD_PATH}/${encodeURIComponent(key)}`
  );
  if (contentType !== null) {
    url.searchParams.set("ct", contentType);
  }
  url.searchParams.set("exp", expiresAt);
  url.searchParams.set("sig", signature);
  if (size !== null) {
    url.searchParams.set("sz", String(size));
  }
  return { expiresAt: expiresAtNumber, key, url: url.toString() };
};

export const putObjectViaFilesWorker = async ({
  body,
  contentType,
  key,
  signal,
}: {
  body: Blob | ArrayBuffer | Uint8Array;
  contentType: string;
  key: string;
  signal?: AbortSignal;
}): Promise<{ etag: string; key: string; size: number }> => {
  const signed = await buildSignedWorkerUploadUrl({
    contentType: contentType || null,
    key,
  });
  const response = await fetch(signed.url, {
    body: body instanceof Uint8Array ? new Uint8Array(body) : body,
    headers: {
      "content-type": contentType,
      "x-teak-request-id": crypto.randomUUID(),
    },
    method: "PUT",
    signal,
  });
  const envelope = (await response.json().catch(() => null)) as FilesEnvelope<{
    etag: string;
    key: string;
    size: number;
  }> | null;
  if (!(response.ok && envelope?.ok)) {
    throw new Error(`files_worker_upload_error:${response.status}`);
  }
  return envelope.data;
};

export interface SignedWorkerOpRequest {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  url: string;
}

export const buildSignedMultipartPartUrl = async (
  {
    key,
    partNumber,
    uploadId,
    size = null,
    ttlSeconds = 60 * 60,
  }: {
    key: string;
    partNumber: number;
    uploadId: string;
    size?: number | null;
    ttlSeconds?: number;
  },
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<string> => {
  const base = env.FILES_BASE;
  const secret = env.FILES_SIGNING_SECRET;
  if (!(base && secret)) {
    throw new Error("files_worker_not_configured");
  }
  assertR2KeyInNamespace(key);
  if (
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds <= 0 ||
    ttlSeconds > (size === null ? 3600 : 86_400) ||
    (size !== null &&
      (!Number.isSafeInteger(size) || size <= 0 || size > 64 * 1024 * 1024))
  ) {
    throw new Error("invalid_multipart_capability");
  }
  const expiresAt = String(nowSeconds + ttlSeconds);
  const signature = await hmacSha256Hex(
    secret,
    buildMultipartPartSigningPayload({
      expiresAt,
      key,
      partNumber,
      uploadId,
      size,
    })
  );
  const url = new URL(
    `${base.replace(/\/+$/, "")}/__uploads/v1/${encodeURIComponent(uploadId)}/${String(partNumber)}`
  );
  if (size !== null) {
    url.searchParams.set("sz", String(size));
  }
  url.searchParams.set("key", key);
  url.searchParams.set("exp", expiresAt);
  url.searchParams.set("sig", signature);
  return url.toString();
};

export const buildSignedWorkerOpRequest = async (
  spec: { op: FilesOp; params: Record<string, unknown> },
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<SignedWorkerOpRequest> => {
  const base = env.FILES_BASE;
  const secret = env.FILES_SIGNING_SECRET;
  if (!(base && secret)) {
    throw new Error("files_worker_not_configured");
  }
  const body = JSON.stringify({
    op: spec.op,
    params: spec.params,
    version: FILES_PROTOCOL_VERSION,
  } satisfies FilesOpRequest);
  const bodySha256 = await sha256Hex(body);
  const expiresAt = String(nowSeconds + FILES_OP_TTL_SECONDS);
  const requestId = crypto.randomUUID();
  const signature = await hmacSha256Hex(
    secret,
    buildFilesOpSigningPayload({ bodySha256, expiresAt, requestId })
  );
  return {
    body,
    headers: {
      "content-type": "application/json",
      "x-teak-expires-at": expiresAt,
      "x-teak-request-id": requestId,
      "x-teak-signature": signature,
    },
    method: "POST",
    url: `${base.replace(/\/+$/, "")}${FILES_OP_PATH}`,
  };
};

/**
 * `fallback`: the worker declined the op (missing source, too large, or
 * unsupported). Network, 5xx and RENDERER_UNAVAILABLE responses throw so
 * workflow retries apply.
 */
export type FilesWorkerOutcome<T> =
  | { kind: "ok"; data: T }
  | { kind: "fallback"; code: FilesErrorCode; message: string };

export const callFilesWorkerJson = async <T>(spec: {
  op: FilesOp;
  params: Record<string, unknown>;
  fallbackCodes?: readonly FilesErrorCode[];
  timeoutMs?: number;
}): Promise<FilesWorkerOutcome<T>> => {
  const signed = await buildSignedWorkerOpRequest(spec);
  let response: Response;
  try {
    const timeoutMs = spec.timeoutMs ?? opTimeoutMs(spec);
    response = await fetch(signed.url, {
      ...signed,
      ...(timeoutMs
        ? {
            signal: AbortSignal.timeout(timeoutMs),
            redirect: "error" as const,
          }
        : {}),
    });
  } catch (error) {
    throw new Error(
      `files_worker_network_error:${error instanceof Error ? error.message : String(error)}`
    );
  }
  const envelope = (await response
    .json()
    .catch(() => null)) as FilesEnvelope<T> | null;
  if (!(response.ok && envelope?.ok)) {
    const code = envelope && !envelope.ok ? envelope.error.code : "INTERNAL";
    const requestId =
      envelope && !envelope.ok ? envelope.error.requestId : "unknown";
    if (
      code === "NOT_FOUND" ||
      code === "PAYLOAD_TOO_LARGE" ||
      code === "UNSUPPORTED" ||
      spec.fallbackCodes?.includes(code)
    ) {
      return {
        kind: "fallback",
        code,
        message:
          envelope && !envelope.ok
            ? String(envelope.error.message).slice(0, 200)
            : code,
      };
    }
    if (code === "AI_CAPACITY" || code === "AI_INVALID_OUTPUT") {
      const error = new Error(
        code === "AI_CAPACITY"
          ? "files_worker_ai: rate limit reached 429"
          : "files_worker_ai: failed to validate JSON"
      );
      const facts =
        envelope && !envelope.ok
          ? readFilesAiGenerationFacts(envelope.error.aiFacts)
          : null;
      throw Object.assign(error, facts ? { aiFacts: facts } : {});
    }
    throw new Error(
      `files_worker_error:${code}:${String(response.status)}:${requestId}`
    );
  }
  return { kind: "ok", data: envelope.data };
};

export type FilesWorkerFinalizeImageResult = FilesFinalizeImageResult;

export interface FilesWorkerBuildExportResult {
  artifactBytes: number;
  filesIncluded: number;
  filesOmitted: number;
  omittedPaths: string[];
}

export interface FilesWorkerHeadObjectResult {
  contentType?: string;
  etag?: string;
  exists: boolean;
  size?: number;
}

export interface FilesWorkerListedObject {
  key: string;
  lastModified: number;
  size: number;
}

export interface FilesWorkerListObjectsResult {
  cursor: string | null;
  objects: FilesWorkerListedObject[];
  truncated: boolean;
}
