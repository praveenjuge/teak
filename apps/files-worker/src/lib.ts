import { buildFileSigningPayload } from "@teak/files-protocol";

export type ParsedRange =
  | { kind: "offset"; offset: number; length?: number }
  | { kind: "suffix"; suffix: number };

/**
 * Parse a single-range `Range` header into an R2 get() range option.
 * Multi-range, non-bytes, and malformed headers are ignored (the caller serves
 * the full object), which RFC 9110 permits. Returns null when the header is
 * absent.
 */
export const parseSingleByteRange = (
  rangeHeader: string | null | undefined
): ParsedRange | null => {
  if (!rangeHeader) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    return null;
  }
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") {
    return null;
  }
  if (rawStart === "") {
    const suffix = Number.parseInt(rawEnd ?? "", 10);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      return null;
    }
    return { kind: "suffix", suffix };
  }
  const start = Number.parseInt(rawStart ?? "", 10);
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    start > Number.MAX_SAFE_INTEGER - 1
  ) {
    return null;
  }
  if (rawEnd === "") {
    return { kind: "offset", offset: start };
  }
  const end = Number.parseInt(rawEnd ?? "", 10);
  if (!Number.isSafeInteger(end) || end < start) {
    return null;
  }
  return { kind: "offset", offset: start, length: end - start + 1 };
};

const hexDecode = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error("Invalid hex string");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

const timingSafeEqualHex = (left: string, right: string): boolean => {
  let leftBytes: Uint8Array;
  let rightBytes: Uint8Array;
  try {
    leftBytes = hexDecode(left);
    rightBytes = hexDecode(right);
  } catch {
    return false;
  }
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  let mismatch = false;
  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) {
      mismatch = true;
    }
  }
  return !mismatch;
};

export const verifyHmacPayload = async (
  secret: string,
  payload: string,
  signature: string
): Promise<boolean> =>
  timingSafeEqualHex(signature, await hmacSha256Hex(secret, payload));

const cryptoKeyCache = new Map<string, Promise<CryptoKey>>();

const getHmacCryptoKey = (secret: string): Promise<CryptoKey> => {
  const cached = cryptoKeyCache.get(secret);
  if (cached) {
    return cached;
  }
  const key = crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  cryptoKeyCache.set(secret, key);
  return key;
};

export const hmacSha256Hex = async (
  secret: string,
  message: string
): Promise<string> => {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await getHmacCryptoKey(secret),
    new TextEncoder().encode(message)
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

export const sha256Hex = async (
  value: string | ArrayBuffer
): Promise<string> => {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

export const verifyBodySignature = async (
  secret: string,
  args: {
    bodySha256: string | null;
    expiresAt: string | null;
    requestId: string | null;
    signature: string | null;
  },
  payload: (fields: {
    bodySha256: string;
    expiresAt: string;
    requestId: string;
  }) => string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<FileRequestVerification> => {
  const { bodySha256, expiresAt, requestId, signature } = args;
  if (!(bodySha256 && expiresAt && requestId && signature)) {
    return { ok: false, status: 401 };
  }
  const expiry = Number.parseInt(expiresAt, 10);
  if (!Number.isSafeInteger(expiry) || String(expiry) !== expiresAt) {
    return { ok: false, status: 403 };
  }
  if (expiry < nowSeconds) {
    return { ok: false, status: 410 };
  }
  if (expiry > nowSeconds + FILES_OP_MAX_TTL_SECONDS) {
    return { ok: false, status: 403 };
  }
  const expected = await hmacSha256Hex(
    secret,
    payload({ bodySha256, expiresAt, requestId })
  );
  return timingSafeEqualHex(signature, expected)
    ? { ok: true }
    : { ok: false, status: 403 };
};

export const FILES_OP_MAX_TTL_SECONDS = 15 * 60;

export type FileRequestVerification =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 410 };

export interface SignedFileRequestParams {
  cd?: string | null | undefined;
  ct?: string | null | undefined;
  exp: string | null | undefined;
  key: string;
  sig: string | null | undefined;
}

export const verifySignedFileRequest = async (
  secret: string,
  { key, exp, sig, ct, cd }: SignedFileRequestParams,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<FileRequestVerification> => {
  if (!(key && exp && sig)) {
    return { ok: false, status: 401 };
  }
  const expiresAt = Number.parseInt(exp, 10);
  if (!Number.isSafeInteger(expiresAt) || `${expiresAt}` !== exp) {
    return { ok: false, status: 403 };
  }
  if (expiresAt < nowSeconds) {
    return { ok: false, status: 410 };
  }
  const expected = await hmacSha256Hex(
    secret,
    buildFileSigningPayload({
      key,
      exp,
      contentType: ct ?? "",
      contentDisposition: cd ?? "",
    })
  );
  return timingSafeEqualHex(sig, expected)
    ? { ok: true }
    : { ok: false, status: 403 };
};
