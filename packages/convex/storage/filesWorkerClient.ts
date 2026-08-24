/**
 * Body-bound POST client for internal operations on files.teakvault.com.
 * Contracts are shared through @teak/files-protocol; authentication binds the
 * exact JSON bytes, request id, and short expiration into one HMAC.
 */

import {
  buildFilesOpSigningPayload,
  buildMultipartPartSigningPayload,
  FILES_OP_PATH,
  FILES_PROTOCOL_VERSION,
  type FilesEnvelope,
  type FilesOp,
  type FilesOpRequest,
} from "@teak/files-protocol";
import { hmacSha256Hex } from "./r2";

// Op URLs are minted per action invocation; a short TTL bounds the replay
// window (the worker additionally rejects exps further than 15 min out).
export const FILES_OP_TTL_SECONDS = 10 * 60;

export const isFilesWorkerConfigured = (): boolean =>
  Boolean(process.env.FILES_BASE && process.env.FILES_SIGNING_SECRET);

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
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
  }: { key: string; partNumber: number; uploadId: string },
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<string> => {
  const base = process.env.FILES_BASE;
  const secret = process.env.FILES_SIGNING_SECRET;
  if (!(base && secret)) {
    throw new Error("files_worker_not_configured");
  }
  const expiresAt = String(nowSeconds + 60 * 60);
  const signature = await hmacSha256Hex(
    secret,
    buildMultipartPartSigningPayload({
      expiresAt,
      key,
      partNumber,
      uploadId,
    })
  );
  const url = new URL(
    `${base.replace(/\/+$/, "")}/__uploads/v1/${encodeURIComponent(uploadId)}/${String(partNumber)}`
  );
  url.searchParams.set("key", key);
  url.searchParams.set("exp", expiresAt);
  url.searchParams.set("sig", signature);
  return url.toString();
};

export const buildSignedWorkerOpRequest = async (
  spec: { op: FilesOp; params: Record<string, unknown> },
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<SignedWorkerOpRequest> => {
  const base = process.env.FILES_BASE;
  const secret = process.env.FILES_SIGNING_SECRET;
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
 * - ok: the op succeeded and returned JSON
 * - fallback: the worker deliberately declined an optional enrichment
 *
 * Network and 5xx responses throw so workflow retries apply.
 */
export type FilesWorkerOutcome<T> =
  | { kind: "ok"; data: T }
  | { kind: "fallback" };

export const callFilesWorkerJson = async <T>(spec: {
  op: FilesOp;
  params: Record<string, unknown>;
}): Promise<FilesWorkerOutcome<T>> => {
  const signed = await buildSignedWorkerOpRequest(spec);
  let response: Response;
  try {
    response = await fetch(signed.url, signed);
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
    if (["NOT_FOUND", "PAYLOAD_TOO_LARGE", "UNSUPPORTED"].includes(code)) {
      return { kind: "fallback" };
    }
    throw new Error(
      `files_worker_error:${code}:${String(response.status)}:${requestId}`
    );
  }
  return { kind: "ok", data: envelope.data };
};

export interface FilesWorkerImageExif {
  exposureTime?: number;
  fNumber?: number;
  focalLength?: number;
  iso?: number;
  latitude?: number;
  longitude?: number;
  make?: string;
  model?: string;
  /** Capture time, epoch milliseconds (when present in the file). */
  takenAt?: number;
}

export interface FilesWorkerProcessImageResult {
  exif: FilesWorkerImageExif | null;
  height: number;
  palette: string[];
  previewGenerated: boolean;
  previewKey: string | null;
  provenance: {
    generatedAt: number;
    processorVersion: string;
    sourceEtag: string;
    transformVersion: string;
  };
  thumbhash: string | null;
  thumbnailGenerated: boolean;
  thumbnailKey: string | null;
  width: number;
}

export interface FilesWorkerBuildExportResult {
  artifactBytes: number;
  filesIncluded: number;
  filesOmitted: number;
  omittedPaths: string[];
}

export interface FilesWorkerInspectResult {
  facts?: Record<string, number>;
  text?: string;
}
