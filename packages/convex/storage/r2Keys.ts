/**
 * Leaf storage primitives: R2 key-namespace helpers and HMAC signing.
 *
 * This module must not import from any other `storage/*` module.
 * `storage/r2` is heavily mocked in tests (see
 * `__tests__/helpers/r2Mock.test-utils.ts`) while `storage/filesWorkerClient`
 * is imported for real alongside those mocks, so anything imported from the
 * mocked surface risks a named-export link error depending on test execution
 * order. Keep every export here pure and dependency-free; `storage/r2`
 * re-exports them for backward compatibility.
 */

/**
 * Internal R2 key prefix for environment isolation.
 * - Production: unset -> "users/..."
 * - Development: "dev/" -> "dev/users/..."
 * This is protection against routine mistakes; shared credentials retain bucket-wide authority.
 */
export const getR2KeyPrefix = (): string => {
  const raw = process.env.R2_KEY_PREFIX ?? "";
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  const normalized = trimmed.replace(/^\/+/, "");
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
};

export const buildR2ListPrefix = (): string => `${getR2KeyPrefix()}users/`;

export const isR2KeyInNamespace = (key: string): boolean =>
  key.startsWith(`${getR2KeyPrefix()}users/`);

export const assertR2KeyInNamespace = (key: string): void => {
  if (!isR2KeyInNamespace(key)) {
    throw new Error("invalid_storage_key_namespace");
  }
};

const hexEncode = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

// Must stay in lockstep with apps/files-worker/src/lib.ts — the shared test
// vectors prove both runtimes produce identical HMAC output.
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
  return hexEncode(
    await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message))
  );
};
