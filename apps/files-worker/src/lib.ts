// Pure signing/verification logic for the files.teakvault.com proxy worker.
// The Convex backend (packages/convex/storage/r2.ts) builds URLs with the
// exact same payload format; the fixed test vector in lib.test.ts locks both
// runtimes to identical HMAC output.

// Must stay in lockstep with PRIVATE_FILE_CACHE_CONTROL in
// packages/convex/storage/r2.ts, and below the signed-URL minimum remaining
// validity (7 days) so browsers never replay an expired signature.
export const FILES_CACHE_CONTROL = "private, max-age=518400, immutable"; // 6 days.

// The Workers Cache API refuses to store responses marked `private`, so the
// copy handed to cache.put() is rewritten to public. Entries are keyed by the
// user-scoped object path, so nothing is shared across users; client-facing
// responses always carry the private directive above.
export const FILES_EDGE_CACHE_CONTROL = "public, max-age=518400, immutable";

export interface R2GetRange {
  length?: number;
  offset?: number;
  suffix?: number;
}

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

export interface FileSigningFields {
  contentDisposition?: string | null;
  contentType?: string | null;
  exp: string;
  key: string;
}

export const buildSigningPayload = ({
  key,
  exp,
  contentType = "",
  contentDisposition = "",
}: FileSigningFields): string =>
  [key, exp, contentType, contentDisposition].join("\n");

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

export const hmacSha256Hex = async (
  secret: string,
  message: string
): Promise<string> => {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(message)
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

// Ops (process-image / build-export / inspect) are internal, short-lived
// requests signed with the same secret as downloads but a distinct payload
// shape so download URLs can never be replayed against an op and vice versa:
//
//   ["op", <op>, <key>, ...extra fields..., <exp>].join("\n")
//
// Extra field values are joined in a fixed per-op order agreed on both sides
// (packages/convex/storage/filesWorkerClient.ts mirrors this module). Empty
// strings are allowed slots.
export const FILES_OP_MAX_TTL_SECONDS = 15 * 60;

export const buildOpSigningPayload = ({
  exp,
  fields,
  key,
  op,
}: {
  op: string;
  key: string;
  fields: string[];
  exp: string;
}): string => ["op", op, key, ...fields, exp].join("\n");

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
    buildSigningPayload({
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

export interface SignedOpRequestParams {
  exp: string | null | undefined;
  fields?: string[];
  sig: string | null | undefined;
}

/**
 * Verify an internal op request. Identical rules to download verification
 * plus an upper bound on remaining validity: op URLs are minted per action
 * invocation and should never live longer than FILES_OP_MAX_TTL_SECONDS, so a
 * leaked URL has a tightly bounded replay window.
 */
export const verifySignedOpRequest = async (
  secret: string,
  op: string,
  key: string,
  { fields = [], exp, sig }: SignedOpRequestParams,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<FileRequestVerification> => {
  if (!(exp && sig)) {
    return { ok: false, status: 401 };
  }
  const expiresAt = Number.parseInt(exp, 10);
  if (!Number.isSafeInteger(expiresAt) || `${expiresAt}` !== exp) {
    return { ok: false, status: 403 };
  }
  if (expiresAt < nowSeconds) {
    return { ok: false, status: 410 };
  }
  if (expiresAt - nowSeconds > FILES_OP_MAX_TTL_SECONDS) {
    return { ok: false, status: 403 };
  }
  const expected = await hmacSha256Hex(
    secret,
    buildOpSigningPayload({ op, key, fields, exp })
  );
  return timingSafeEqualHex(sig, expected)
    ? { ok: true }
    : { ok: false, status: 403 };
};
