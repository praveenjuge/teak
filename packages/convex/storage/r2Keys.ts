import {
  type FilesKeyPrefix,
  filesExportKeyRoot,
  filesUserKeyRoot,
  parseFilesKeyPrefix,
} from "@teak/files-protocol";
import { env } from "../_generated/server";

/** `""` in production and `dev/` in development; anything else throws. */
export const getR2KeyPrefix = (): FilesKeyPrefix =>
  parseFilesKeyPrefix(env.R2_KEY_PREFIX);

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
