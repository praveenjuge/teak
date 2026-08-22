// Pure signing/verification logic for the files.teakvault.com proxy worker.
// The Convex backend (packages/convex/storage/r2.ts) builds URLs with the
// exact same payload format; the fixed test vector in lib.test.ts locks both
// runtimes to identical HMAC output.

export const FILES_CACHE_CONTROL = "private, max-age=900, immutable";

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
