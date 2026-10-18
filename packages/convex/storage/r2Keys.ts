import { filesExportKeyRoot, filesUserKeyRoot } from "@teak/files-protocol";
import { env } from "../_generated/server";

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

// The R2 lifecycle rule on `exports/` (and `dev/exports/`) expires every
// artifact, sidecar and leftover manifest under this prefix.
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
