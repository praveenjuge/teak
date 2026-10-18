import {
  buildFileSigningPayload,
  buildImageSigningPayload,
  FILES_IMAGE_PATH,
  FILES_SIGNED_URL_MIN_VALIDITY_SECONDS,
  type FilesImageRendition,
} from "@teak/files-protocol";
import { env } from "../_generated/server";
import { inferFileFormat } from "../shared/fileFormats";
import {
  assertR2KeyInNamespace,
  hmacSha256Hex,
  isR2KeyInNamespace,
} from "./r2Keys";

const SIGNED_URL_BUCKET_SECONDS = 6 * 60 * 60;

export const bucketedSignatureExpiry = (
  nowSeconds = Math.floor(Date.now() / 1000)
): number =>
  (Math.floor(nowSeconds / SIGNED_URL_BUCKET_SECONDS) + 1) *
    SIGNED_URL_BUCKET_SECONDS +
  FILES_SIGNED_URL_MIN_VALIDITY_SECONDS;

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
  contentDisposition?: "attachment" | "inline" | `attachment; ${string}`;
  contentType?: string;
}

/**
 * `attachment` with the file's name (RFC 6266 / RFC 8187), so a browser saves
 * a cross-origin file under its original name instead of opening it.
 */
export const attachmentContentDisposition = (
  fileName: string
): `attachment; ${string}` => {
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename*=UTF-8''${encoded}`;
};

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

export const buildSignedWorkerFileUrl = async (
  base: string,
  secret: string,
  key: string,
  response: DownloadResponsePolicy = {},
  expSeconds = Math.floor(Date.now() / 1000) +
    FILES_SIGNED_URL_MIN_VALIDITY_SECONDS
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
  expSeconds = Math.floor(Date.now() / 1000) +
    FILES_SIGNED_URL_MIN_VALIDITY_SECONDS
): Promise<string> => {
  const exp = String(expSeconds);
  const signature = await hmacSha256Hex(
    secret,
    buildFileSigningPayload({ key, exp, ...response })
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
  expSeconds = Math.floor(Date.now() / 1000) +
    FILES_SIGNED_URL_MIN_VALIDITY_SECONDS
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
  expSeconds = Math.floor(Date.now() / 1000) +
    FILES_SIGNED_URL_MIN_VALIDITY_SECONDS
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

export const resolveDownloadUrl = async (key: string, fileName: string) =>
  await getR2Url(key, {
    contentType: fileDownloadResponsePolicy(fileName).contentType,
    contentDisposition: attachmentContentDisposition(fileName),
  });

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
