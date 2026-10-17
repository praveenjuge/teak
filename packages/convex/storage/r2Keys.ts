/**
 * Leaf storage primitives: R2 key-namespace helpers, SHA-256 hashing and
 * HMAC signing.
 *
 * This module must not import from any other `storage/*` module.
 * `storage/r2` is heavily mocked in tests (see
 * `__tests__/helpers/r2Mock.test-utils.ts`) while `storage/filesWorkerClient`
 * is imported for real alongside those mocks, so anything imported from the
 * mocked surface risks a named-export link error depending on test execution
 * order. Keep every export here pure and dependency-free.
 */

import { filesExportKeyRoot, filesUserKeyRoot } from "@teak/files-protocol";
import { env } from "../_generated/server";

/**
 * Internal R2 key prefix for environment isolation.
 * - Production: unset -> "users/..."
 * - Development: "dev/" -> "dev/users/..."
 * This is protection against routine mistakes; shared credentials retain bucket-wide authority.
 */
export const getR2KeyPrefix = (): string => {
  const raw = env.R2_KEY_PREFIX ?? "";
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  const normalized = trimmed.replace(/^\/+/, "");
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
};

export const buildR2ListPrefix = (): string =>
  filesUserKeyRoot(getR2KeyPrefix());

/**
 * Export archives live outside `users/` under their own top-level prefix, so
 * an R2 lifecycle rule on `exports/` (and `dev/exports/`) can expire every
 * artifact, sidecar and leftover manifest without per-user prefixes.
 */
export const buildR2ExportPrefix = (): string =>
  filesExportKeyRoot(getR2KeyPrefix());

export const isR2KeyInNamespace = (key: string): boolean =>
  key.startsWith(buildR2ListPrefix()) || key.startsWith(buildR2ExportPrefix());

export const assertR2KeyInNamespace = (key: string): void => {
  if (!isR2KeyInNamespace(key)) {
    throw new Error("invalid_storage_key_namespace");
  }
};

const hexEncode = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

/** Lowercase hex SHA-256 of a string (as UTF-8) or of raw bytes. */
export const sha256Hex = async (value: string | ArrayBuffer): Promise<string> =>
  hexEncode(
    await crypto.subtle.digest(
      "SHA-256",
      typeof value === "string" ? new TextEncoder().encode(value) : value
    )
  );

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
