/**
 * Leaf storage primitives: signed file/image URL minting and resolution.
 *
 * This module must not import from `storage/r2`. `storage/r2` is heavily
 * mocked in tests (see `__tests__/helpers/r2Mock.test-utils.ts`), and Bun's
 * `mock.module` registry is process-global with last-registration-wins
 * semantics: any function imported from the mocked surface observes the
 * *mock's* siblings for its internal calls, and any export missing from an
 * inline mock breaks every importer with a link error. Tests that need real
 * URL resolution (namespace containment, signed-URL vectors) therefore import
 * from this module, which MUST NEVER BE MOCKED — mocking it would poison
 * every suite file the same way. Keep every export pure and dependency-free
 * apart from `storage/r2Keys`, `shared/fileFormats`, and `env`; `storage/r2`
 * re-exports them for backward compatibility.
 */

import {
  buildImageSigningPayload,
  FILES_IMAGE_PATH,
  type FilesImageRendition,
} from "@teak/files-protocol";
import { env } from "../_generated/server";
import { inferFileFormat } from "../shared/fileFormats";
import {
  assertR2KeyInNamespace,
  hmacSha256Hex,
  isR2KeyInNamespace,
} from "./r2Keys";

// Object keys are content-immutable (every upload writes a fresh UUID key), so
// signed URLs can live far longer than a single session. Long-lived,
// time-bucketed URLs keep the URL string identical across reactive query
// re-runs and page loads, which is what lets the browser HTTP cache actually
// serve repeat views instead of refetching every card image.
const SIGNED_URL_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;
// All signatures produced within one bucket window share the same exp (and
// therefore the exact same URL). Buckets also guarantee a minimum remaining
// validity of SIGNED_URL_EXPIRES_IN_SECONDS at generation time.
const SIGNED_URL_BUCKET_SECONDS = 6 * 60 * 60;

/**
 * Deterministic expiry for the current bucket window: every call made within
 * the same window returns an identical exp string.
 */
export const bucketedSignatureExpiry = (
  nowSeconds = Math.floor(Date.now() / 1000)
): number =>
  (Math.floor(nowSeconds / SIGNED_URL_BUCKET_SECONDS) + 1) *
    SIGNED_URL_BUCKET_SECONDS +
  SIGNED_URL_EXPIRES_IN_SECONDS;

// Browser-facing cache directive; keep in lockstep with FILES_CACHE_CONTROL
// in apps/files-worker/src/lib.ts and below the signed-URL minimum remaining
// validity so browsers never replay an expired signature.
export const PRIVATE_FILE_CACHE_CONTROL = "private, max-age=518400, immutable"; // 6 days.

export type R2ObjectKey = string;

export const getR2ReadBase = (key: string): string => {
  const filesBase = env.FILES_BASE;
  if (isR2KeyInNamespace(key)) {
    if (!filesBase) {
      throw new Error("files_worker_not_configured");
    }
    return filesBase;
  }

  throw new Error("invalid_storage_key_namespace");
};

interface DownloadResponsePolicy {
  contentDisposition?: "attachment" | "inline";
  contentType?: string;
}

export const fileDownloadResponsePolicy = (
  fileName: string | null
): Required<DownloadResponsePolicy> => {
  const format = fileName ? inferFileFormat({ fileName }) : null;
  if (!format) {
    return {
      contentDisposition: "attachment",
      contentType: "application/octet-stream",
    };
  }

  const canRenderInline =
    format.id !== "svg" &&
    (format.id === "pdf" ||
      ["audio", "image", "video"].includes(format.cardType));

  return {
    contentDisposition: canRenderInline ? "inline" : "attachment",
    contentType: format.mimeType,
  };
};

export const getR2Url = async (
  key: string,
  response: DownloadResponsePolicy = {}
) => {
  const signingSecret = env.FILES_SIGNING_SECRET;
  if (!signingSecret) {
    throw new Error("files_worker_not_configured");
  }
  return await buildSignedWorkerFileUrlUnchecked(
    getR2ReadBase(key),
    signingSecret,
    key,
    response,
    bucketedSignatureExpiry()
  );
};

// Must stay in lockstep with apps/files-worker/src/lib.ts — the shared test
// vector proves both runtimes produce identical HMAC output.
export const buildSignedFilePayload = ({
  key,
  exp,
  contentType = "",
  contentDisposition = "",
}: {
  key: string;
  exp: string;
  contentType?: string | null;
  contentDisposition?: string | null;
}): string => [key, exp, contentType, contentDisposition].join("\n");

export const buildSignedWorkerFileUrl = async (
  base: string,
  secret: string,
  key: string,
  response: DownloadResponsePolicy = {},
  expSeconds = Math.floor(Date.now() / 1000) + SIGNED_URL_EXPIRES_IN_SECONDS
): Promise<string> => {
  assertR2KeyInNamespace(key);
  return await buildSignedWorkerFileUrlUnchecked(
    base,
    secret,
    key,
    response,
    expSeconds
  );
};

const buildSignedWorkerFileUrlUnchecked = async (
  base: string,
  secret: string,
  key: string,
  response: DownloadResponsePolicy = {},
  expSeconds = Math.floor(Date.now() / 1000) + SIGNED_URL_EXPIRES_IN_SECONDS
): Promise<string> => {
  const exp = String(expSeconds);
  const signature = await hmacSha256Hex(
    secret,
    buildSignedFilePayload({ key, exp, ...response })
  );
  const params = new URLSearchParams({ exp, sig: signature });
  if (response.contentType) {
    params.set("ct", response.contentType);
  }
  if (response.contentDisposition) {
    params.set("cd", response.contentDisposition);
  }
  return `${base.replace(/\/+$/, "")}/${key}?${params.toString()}`;
};

export const buildSignedWorkerImageUrl = async (
  base: string,
  secret: string,
  key: string,
  rendition: FilesImageRendition,
  expSeconds = Math.floor(Date.now() / 1000) + SIGNED_URL_EXPIRES_IN_SECONDS
): Promise<string> => {
  assertR2KeyInNamespace(key);
  return await buildSignedWorkerImageUrlUnchecked(
    base,
    secret,
    key,
    rendition,
    expSeconds
  );
};

const buildSignedWorkerImageUrlUnchecked = async (
  base: string,
  secret: string,
  key: string,
  rendition: FilesImageRendition,
  expSeconds = Math.floor(Date.now() / 1000) + SIGNED_URL_EXPIRES_IN_SECONDS
): Promise<string> => {
  const expiresAt = String(expSeconds);
  const signature = await hmacSha256Hex(
    secret,
    buildImageSigningPayload({ expiresAt, key, rendition })
  );
  const params = new URLSearchParams({ exp: expiresAt, sig: signature });
  return `${base.replace(/\/+$/, "")}${FILES_IMAGE_PATH}/${rendition}/${encodeURIComponent(key)}?${params.toString()}`;
};

export const resolveObjectUrl = async (
  key?: string,
  fileName?: string | null
) => {
  if (!key) {
    return null;
  }
  return await getR2Url(
    key,
    fileName === undefined ? {} : fileDownloadResponsePolicy(fileName)
  );
};

export const resolveImageUrl = async (
  key: string | undefined,
  rendition: FilesImageRendition
): Promise<string | null> => {
  if (!key) {
    return null;
  }
  const signingSecret = env.FILES_SIGNING_SECRET;
  if (!signingSecret) {
    throw new Error("files_worker_not_configured");
  }
  return await buildSignedWorkerImageUrlUnchecked(
    getR2ReadBase(key),
    signingSecret,
    key,
    rendition,
    bucketedSignatureExpiry()
  );
};

export const isStorageNamespaceError = (error: unknown): boolean =>
  error instanceof Error && error.message === "invalid_storage_key_namespace";

/**
 * Resolve a file URL, treating an out-of-namespace key as an absent object.
 * All other errors (misconfiguration, signing failures) still throw.
 */
export const tryResolveObjectUrl = async (
  key?: string,
  fileName?: string | null
): Promise<string | null> => {
  try {
    return await resolveObjectUrl(key, fileName);
  } catch (error) {
    if (isStorageNamespaceError(error)) {
      return null;
    }
    throw error;
  }
};

/**
 * Resolve an image rendition URL, treating an out-of-namespace key as an
 * absent object. All other errors still throw.
 */
export const tryResolveImageUrl = async (
  key: string | undefined,
  rendition: FilesImageRendition
): Promise<string | null> => {
  try {
    return await resolveImageUrl(key, rendition);
  } catch (error) {
    if (isStorageNamespaceError(error)) {
      return null;
    }
    throw error;
  }
};
