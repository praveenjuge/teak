/**
 * The signed HTTP boundary between Convex and the Core Worker. Each request
 * kind has a sign function the caller uses and a verify function the
 * receiver uses, so the route, headers, limits and expiry rules live once.
 * Everything here runs on WebCrypto, in Convex, Workers and Bun alike.
 */

import {
  buildFilesOpSigningPayload,
  buildMultipartPartSigningPayload,
  buildUploadSigningPayload,
  FILES_OP_MAX_TTL_SECONDS,
  FILES_OP_PATH,
  FILES_OP_TTL_SECONDS,
  FILES_PROTOCOL_VERSION,
  FILES_UPLOAD_MAX_TTL_SECONDS,
  FILES_UPLOAD_PATH,
  type FilesErrorCode,
  type FilesErrorEnvelope,
  type FilesOp,
  type FilesOpRequest,
  type FilesSuccessEnvelope,
} from "./ops";
import { isValidObjectKey } from "./storage";
import {
  buildWorkflowDispatchSigningPayload,
  buildWorkflowRpcSigningPayload,
  WORKFLOW_RPC_MAX_TTL_SECONDS,
  WORKFLOW_RPC_PATH,
} from "./workflows";

/** Headers that carry a signed request's id, expiry and signature. */
export const SIGNED_REQUEST_HEADERS = {
  expiresAt: "x-teak-expires-at",
  requestId: "x-teak-request-id",
  signature: "x-teak-signature",
} as const;

/** The largest signed op request body the Worker reads. */
export const FILES_OP_MAX_BODY_BYTES = 1024 * 1024;

export const FILES_MULTIPART_PART_PATH = "/__uploads/v1" as const;
/** R2 needs every part but the last to be the same size; 100 covers 100 MiB at 1 MiB. */
export const FILES_MULTIPART_MAX_PARTS = 100;
/** A part URL with no size bound is valid this long and takes this much. */
export const FILES_MULTIPART_URL_MAX_TTL_SECONDS = 60 * 60;
export const FILES_MULTIPART_MAX_PART_BYTES = 16 * 1024 * 1024;
/** A part URL bound to an exact size may live a day and carry this much. */
export const FILES_MULTIPART_SIZED_URL_MAX_TTL_SECONDS = 24 * 60 * 60;
export const FILES_MULTIPART_SIZED_PART_MAX_BYTES = 64 * 1024 * 1024;

/** Validity Convex gives a single-file upload URL it mints. */
export const FILES_UPLOAD_TTL_SECONDS = 10 * 60;
/** Validity of a workflow RPC call and a dispatch proof. */
export const WORKFLOW_RPC_TTL_SECONDS = 2 * 60;

const hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

const encoder = new TextEncoder();

export const sha256Hex = async (
  value: string | ArrayBuffer | Uint8Array
): Promise<string> =>
  hex(
    await crypto.subtle.digest(
      "SHA-256",
      typeof value === "string"
        ? encoder.encode(value)
        : (value as BufferSource)
    )
  );

// Resolved keys only: a promise made in one request must not be awaited in
// another on Workers.
const hmacKeys = new Map<string, CryptoKey>();

const hmacKey = async (secret: string): Promise<CryptoKey> => {
  const cached = hmacKeys.get(secret);
  if (cached) {
    return cached;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  if (hmacKeys.size > 32) {
    hmacKeys.clear();
  }
  hmacKeys.set(secret, key);
  return key;
};

export const hmacSha256Hex = async (
  secret: string,
  message: string
): Promise<string> =>
  hex(
    await crypto.subtle.sign(
      "HMAC",
      await hmacKey(secret),
      encoder.encode(message)
    )
  );

/**
 * Compares two hex digests in time that depends only on their length. Case
 * is ignored, so an upper-case signature still matches.
 */
export const hexDigestsMatch = (given: string, expected: string): boolean => {
  if (given.length !== expected.length || !/^[0-9a-f]*$/iu.test(given)) {
    return false;
  }
  const left = given.toLowerCase();
  const right = expected.toLowerCase();
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch += (left.charCodeAt(index) - right.charCodeAt(index)) ** 2;
  }
  return mismatch === 0;
};

export const verifyHmacHex = async (
  secret: string,
  payload: string,
  signature: string
): Promise<boolean> =>
  hexDigestsMatch(signature, await hmacSha256Hex(secret, payload));

export const nowInSeconds = (): number => Math.floor(Date.now() / 1000);

export type SignedExpiry = "valid" | "malformed" | "expired" | "too_far";

/**
 * A signed request's expiry: Unix seconds written as a plain integer, not
 * past, and no further out than `maxTtlSeconds` (null: no upper bound, as
 * for long-lived file links).
 */
export const checkSignedExpiry = (
  expiresAt: string,
  maxTtlSeconds: number | null,
  nowSeconds = nowInSeconds()
): SignedExpiry => {
  const expiry = Number(expiresAt);
  if (!Number.isSafeInteger(expiry) || String(expiry) !== expiresAt) {
    return "malformed";
  }
  if (expiry < nowSeconds) {
    return "expired";
  }
  if (maxTtlSeconds !== null && expiry > nowSeconds + maxTtlSeconds) {
    return "too_far";
  }
  return "valid";
};

export type SignatureCheck =
  | { ok: true }
  | {
      code: Extract<FilesErrorCode, "AUTH_EXPIRED" | "AUTH_INVALID">;
      ok: false;
      status: 401 | 403 | 410;
    };

type SignatureFailure = Exclude<SignatureCheck, { ok: true }>;

const MISSING: SignatureFailure = {
  code: "AUTH_INVALID",
  ok: false,
  status: 401,
};
const REFUSED: SignatureFailure = {
  code: "AUTH_INVALID",
  ok: false,
  status: 403,
};
const EXPIRED: SignatureFailure = {
  code: "AUTH_EXPIRED",
  ok: false,
  status: 410,
};

const expiryCheck = (
  expiresAt: string,
  maxTtlSeconds: number | null,
  nowSeconds: number
): SignatureFailure | null => {
  const expiry = checkSignedExpiry(expiresAt, maxTtlSeconds, nowSeconds);
  if (expiry === "valid") {
    return null;
  }
  return expiry === "expired" ? EXPIRED : REFUSED;
};

/** Checks a signed request's expiry, then its HMAC over `payload`. */
export const verifySignature = async (
  secret: string,
  fields: {
    expiresAt: string | null | undefined;
    maxTtlSeconds: number | null;
    payload: (expiresAt: string) => string;
    signature: string | null | undefined;
  },
  nowSeconds = nowInSeconds()
): Promise<SignatureCheck> => {
  const { expiresAt, signature } = fields;
  if (!(expiresAt && signature)) {
    return MISSING;
  }
  const expiry = expiryCheck(expiresAt, fields.maxTtlSeconds, nowSeconds);
  if (expiry) {
    return expiry;
  }
  return (await verifyHmacHex(secret, fields.payload(expiresAt), signature))
    ? { ok: true }
    : REFUSED;
};

export const filesErrorEnvelope = ({
  aiFacts,
  code,
  message,
  requestId,
  retryable = false,
}: {
  aiFacts?: FilesErrorEnvelope["error"]["aiFacts"];
  code: FilesErrorCode;
  message: string;
  requestId: string;
  retryable?: boolean;
}): FilesErrorEnvelope => ({
  error: {
    code,
    message,
    requestId,
    retryable,
    ...(aiFacts ? { aiFacts } : {}),
  },
  ok: false,
  version: FILES_PROTOCOL_VERSION,
});

export const filesSuccessEnvelope = <T>(
  requestId: string,
  data: T
): FilesSuccessEnvelope<T> => ({
  data,
  ok: true,
  requestId,
  version: FILES_PROTOCOL_VERSION,
});

const withoutTrailingSlash = (base: string): string =>
  base.replace(/\/+$/u, "");

export interface SignedOpRequest {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  url: string;
}

export const signFilesOpRequest = async (
  {
    base,
    op,
    params,
    secret,
    requestId = crypto.randomUUID(),
  }: {
    base: string;
    op: FilesOp;
    params: Record<string, unknown>;
    requestId?: string;
    secret: string;
  },
  nowSeconds = nowInSeconds()
): Promise<SignedOpRequest> => {
  const body = JSON.stringify({
    op,
    params,
    version: FILES_PROTOCOL_VERSION,
  } satisfies FilesOpRequest);
  const expiresAt = String(nowSeconds + FILES_OP_TTL_SECONDS);
  const signature = await hmacSha256Hex(
    secret,
    buildFilesOpSigningPayload({
      bodySha256: await sha256Hex(body),
      expiresAt,
      requestId,
    })
  );
  return {
    body,
    headers: {
      "content-type": "application/json",
      [SIGNED_REQUEST_HEADERS.expiresAt]: expiresAt,
      [SIGNED_REQUEST_HEADERS.requestId]: requestId,
      [SIGNED_REQUEST_HEADERS.signature]: signature,
    },
    method: "POST",
    url: `${withoutTrailingSlash(base)}${FILES_OP_PATH}`,
  };
};

export const verifyFilesOpRequest = async (
  secret: string,
  headers: Headers,
  body: string,
  nowSeconds = nowInSeconds()
): Promise<SignatureCheck> => {
  const requestId = headers.get(SIGNED_REQUEST_HEADERS.requestId);
  if (!requestId) {
    return MISSING;
  }
  const bodySha256 = await sha256Hex(body);
  return await verifySignature(
    secret,
    {
      expiresAt: headers.get(SIGNED_REQUEST_HEADERS.expiresAt),
      maxTtlSeconds: FILES_OP_MAX_TTL_SECONDS,
      payload: (expiresAt) =>
        buildFilesOpSigningPayload({ bodySha256, expiresAt, requestId }),
      signature: headers.get(SIGNED_REQUEST_HEADERS.signature),
    },
    nowSeconds
  );
};

export interface SignedUploadUrl {
  expiresAt: number;
  key: string;
  url: string;
}

/**
 * A PUT URL for one object. A null content type leaves it unbound (the
 * Worker stores the request's own); a null size relies on the Worker's cap.
 */
export const signUploadUrl = async (
  {
    base,
    contentType,
    key,
    secret,
    size = null,
    ttlSeconds = FILES_UPLOAD_TTL_SECONDS,
  }: {
    base: string;
    contentType: string | null;
    key: string;
    secret: string;
    size?: number | null;
    ttlSeconds?: number;
  },
  nowSeconds = nowInSeconds()
): Promise<SignedUploadUrl> => {
  if (
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds <= 0 ||
    ttlSeconds > FILES_UPLOAD_MAX_TTL_SECONDS
  ) {
    throw new Error("invalid_upload_ttl");
  }
  const expiresAt = nowSeconds + ttlSeconds;
  const signature = await hmacSha256Hex(
    secret,
    buildUploadSigningPayload({
      contentType: contentType ?? "",
      expiresAt: String(expiresAt),
      key,
      size,
    })
  );
  const url = new URL(
    `${withoutTrailingSlash(base)}${FILES_UPLOAD_PATH}/${encodeURIComponent(key)}`
  );
  if (contentType !== null) {
    url.searchParams.set("ct", contentType);
  }
  url.searchParams.set("exp", String(expiresAt));
  url.searchParams.set("sig", signature);
  if (size !== null) {
    url.searchParams.set("sz", String(size));
  }
  return { expiresAt, key, url: url.toString() };
};

export type UploadUrlCheck =
  | { contentType: string; key: string; ok: true; size: number | null }
  | {
      code: FilesErrorCode;
      message: string;
      ok: false;
      status: 400 | 401 | 403 | 410;
    };

const MAX_CONTENT_TYPE_LENGTH = 255;
const CONTENT_TYPE =
  /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+\/[!#$%&'*+\-.^_`|~0-9A-Za-z]+(?:\s*;.*)?$/u;

const isValidContentType = (value: string): boolean =>
  value.length > 0 &&
  value.length <= MAX_CONTENT_TYPE_LENGTH &&
  CONTENT_TYPE.test(value);

const authFailure = (check: SignatureFailure) => ({
  code: check.code,
  message: "Request authentication failed",
  ok: false as const,
  status: check.status,
});

/**
 * Checks a PUT to a signed upload URL. `requestContentType` is the request's
 * Content-Type header; the stored type is the signed one when the URL binds
 * one.
 */
export const verifyUploadUrl = async (
  secret: string,
  url: URL,
  requestContentType: string | null,
  nowSeconds = nowInSeconds()
): Promise<UploadUrlCheck> => {
  let key = "";
  try {
    key = decodeURIComponent(
      url.pathname.slice(`${FILES_UPLOAD_PATH}/`.length)
    );
  } catch {
    key = "";
  }
  if (
    !(url.pathname.startsWith(`${FILES_UPLOAD_PATH}/`) && isValidObjectKey(key))
  ) {
    return {
      code: "INVALID_INPUT",
      message: "Invalid object key",
      ok: false,
      status: 400,
    };
  }
  const expiresAt = url.searchParams.get("exp");
  const signature = url.searchParams.get("sig");
  if (!(expiresAt && signature)) {
    return authFailure(MISSING);
  }
  const fromRequest =
    requestContentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  const boundContentType = url.searchParams.has("ct");
  const contentType = boundContentType
    ? url.searchParams.get("ct") || fromRequest
    : fromRequest;
  if (!isValidContentType(contentType)) {
    return {
      code: "INVALID_INPUT",
      message: "A valid Content-Type is required",
      ok: false,
      status: 400,
    };
  }
  const sizeText = url.searchParams.get("sz");
  const size = sizeText ? Number.parseInt(sizeText, 10) : null;
  const check = await verifySignature(
    secret,
    {
      expiresAt,
      maxTtlSeconds: FILES_UPLOAD_MAX_TTL_SECONDS,
      payload: (exp) =>
        buildUploadSigningPayload({
          contentType: boundContentType ? contentType : "",
          expiresAt: exp,
          key,
          size,
        }),
      signature,
    },
    nowSeconds
  );
  return check.ok ? { contentType, key, ok: true, size } : authFailure(check);
};

const multipartTtlLimit = (size: number | null): number =>
  size === null
    ? FILES_MULTIPART_URL_MAX_TTL_SECONDS
    : FILES_MULTIPART_SIZED_URL_MAX_TTL_SECONDS;

const isValidPartNumber = (partNumber: number): boolean =>
  Number.isSafeInteger(partNumber) &&
  partNumber >= 1 &&
  partNumber <= FILES_MULTIPART_MAX_PARTS;

const isValidPartSize = (size: number | null): boolean =>
  size === null ||
  (Number.isSafeInteger(size) &&
    size > 0 &&
    size <= FILES_MULTIPART_SIZED_PART_MAX_BYTES);

/** The most bytes one part may carry under its URL's size bound. */
export const multipartPartLimit = (size: number | null): number =>
  size ?? FILES_MULTIPART_MAX_PART_BYTES;

export const signMultipartPartUrl = async (
  {
    base,
    key,
    partNumber,
    secret,
    size = null,
    uploadId,
    ttlSeconds = size === null
      ? FILES_MULTIPART_URL_MAX_TTL_SECONDS
      : FILES_MULTIPART_SIZED_URL_MAX_TTL_SECONDS,
  }: {
    base: string;
    key: string;
    partNumber: number;
    secret: string;
    size?: number | null;
    ttlSeconds?: number;
    uploadId: string;
  },
  nowSeconds = nowInSeconds()
): Promise<string> => {
  if (
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds <= 0 ||
    ttlSeconds > multipartTtlLimit(size) ||
    !isValidPartNumber(partNumber) ||
    !isValidPartSize(size)
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
      size,
      uploadId,
    })
  );
  const url = new URL(
    `${withoutTrailingSlash(base)}${FILES_MULTIPART_PART_PATH}/${encodeURIComponent(uploadId)}/${String(partNumber)}`
  );
  if (size !== null) {
    url.searchParams.set("sz", String(size));
  }
  url.searchParams.set("key", key);
  url.searchParams.set("exp", expiresAt);
  url.searchParams.set("sig", signature);
  return url.toString();
};

export type MultipartPartUrlCheck =
  | {
      key: string;
      ok: true;
      partNumber: number;
      size: number | null;
      uploadId: string;
    }
  | (SignatureFailure & { message: string });

const MULTIPART_PART_ROUTE = new RegExp(
  `^${FILES_MULTIPART_PART_PATH.replaceAll("/", "\\/")}\\/([^/]+)\\/(\\d+)$`,
  "u"
);

export const verifyMultipartPartUrl = async (
  secret: string,
  url: URL,
  nowSeconds = nowInSeconds()
): Promise<MultipartPartUrlCheck> => {
  const match = MULTIPART_PART_ROUTE.exec(url.pathname);
  const key = url.searchParams.get("key");
  const expiresAt = url.searchParams.get("exp");
  const signature = url.searchParams.get("sig");
  const sizeText = url.searchParams.get("sz");
  if (!(match && key && expiresAt && signature)) {
    return authFailure(MISSING);
  }
  let uploadId = "";
  try {
    uploadId = decodeURIComponent(match[1] ?? "");
  } catch {
    // A malformed escape cannot name a signed upload; refused below.
  }
  const partNumber = Number.parseInt(match[2] ?? "", 10);
  const size = sizeText === null ? null : Number(sizeText);
  const sizeMalformed =
    size !== null && (!isValidPartSize(size) || String(size) !== sizeText);
  const check = await verifySignature(
    secret,
    {
      expiresAt,
      maxTtlSeconds: multipartTtlLimit(sizeMalformed ? null : size),
      payload: (exp) =>
        buildMultipartPartSigningPayload({
          expiresAt: exp,
          key,
          partNumber,
          size,
          uploadId,
        }),
      signature,
    },
    nowSeconds
  );
  if (!check.ok) {
    return authFailure(check);
  }
  if (!(uploadId && isValidPartNumber(partNumber)) || sizeMalformed) {
    return authFailure(REFUSED);
  }
  return { key, ok: true, partNumber, size, uploadId };
};

export const signWorkflowRpcRequest = async (
  {
    body,
    convexSiteUrl,
    secret,
    requestId = crypto.randomUUID(),
  }: {
    body: string;
    convexSiteUrl: string;
    requestId?: string;
    secret: string;
  },
  nowSeconds = nowInSeconds()
): Promise<{ headers: Record<string, string>; url: string }> => {
  const expiresAt = String(nowSeconds + WORKFLOW_RPC_TTL_SECONDS);
  const signature = await hmacSha256Hex(
    secret,
    buildWorkflowRpcSigningPayload({
      bodySha256: await sha256Hex(body),
      convexSiteUrl,
      expiresAt,
      requestId,
    })
  );
  return {
    headers: {
      "content-type": "application/json",
      [SIGNED_REQUEST_HEADERS.expiresAt]: expiresAt,
      [SIGNED_REQUEST_HEADERS.requestId]: requestId,
      [SIGNED_REQUEST_HEADERS.signature]: signature,
    },
    url: `${convexSiteUrl}${WORKFLOW_RPC_PATH}`,
  };
};

export const verifyWorkflowRpcRequest = async (
  secret: string,
  convexSiteUrl: string,
  headers: Headers,
  body: ArrayBuffer | string,
  nowSeconds = nowInSeconds()
): Promise<boolean> => {
  const requestId = headers.get(SIGNED_REQUEST_HEADERS.requestId);
  if (!requestId || requestId.length > 128) {
    return false;
  }
  const bodySha256 = await sha256Hex(body);
  const check = await verifySignature(
    secret,
    {
      expiresAt: headers.get(SIGNED_REQUEST_HEADERS.expiresAt),
      maxTtlSeconds: WORKFLOW_RPC_MAX_TTL_SECONDS,
      payload: (expiresAt) =>
        buildWorkflowRpcSigningPayload({
          bodySha256,
          convexSiteUrl,
          expiresAt,
          requestId,
        }),
      signature: headers.get(SIGNED_REQUEST_HEADERS.signature),
    },
    nowSeconds
  );
  return check.ok;
};

/**
 * Proof that a deployment's own workflow RPC secret signed the items it
 * dispatches: the files signing secret that authenticates the op is shared
 * with development, so it alone can't say which deployment sent it.
 */
export const signDispatchProof = async (
  {
    convexSiteUrl,
    items,
    secret,
  }: { convexSiteUrl: string; items: unknown[]; secret: string },
  nowSeconds = nowInSeconds()
): Promise<{ expiresAt: string; signature: string }> => {
  const expiresAt = String(nowSeconds + WORKFLOW_RPC_TTL_SECONDS);
  const signature = await hmacSha256Hex(
    secret,
    buildWorkflowDispatchSigningPayload({
      convexSiteUrl,
      expiresAt,
      itemsSha256: await sha256Hex(JSON.stringify(items)),
    })
  );
  return { expiresAt, signature };
};

export const verifyDispatchProof = async (
  secret: string,
  convexSiteUrl: string,
  proof: { expiresAt: unknown; items: unknown; signature: unknown },
  nowSeconds = nowInSeconds()
): Promise<boolean> => {
  const { expiresAt, items, signature } = proof;
  if (typeof expiresAt !== "string" || typeof signature !== "string") {
    return false;
  }
  const itemsSha256 = await sha256Hex(JSON.stringify(items));
  const check = await verifySignature(
    secret,
    {
      expiresAt,
      maxTtlSeconds: WORKFLOW_RPC_MAX_TTL_SECONDS,
      payload: (exp) =>
        buildWorkflowDispatchSigningPayload({
          convexSiteUrl,
          expiresAt: exp,
          itemsSha256,
        }),
      signature,
    },
    nowSeconds
  );
  return check.ok;
};

/** The string the Worker signs for each Save by email request to Convex. */
export const buildInboundEmailSigningPayload = (
  path: string,
  timestamp: string,
  bodySha256: string
): string => `teak-inbound-email\nv1\n${path}\n${timestamp}\n${bodySha256}`;
