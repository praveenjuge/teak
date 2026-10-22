export type FilesRemoteAssetKind = "image" | "video";

export const FILES_REMOTE_ASSET_MAX_BYTES: Record<
  FilesRemoteAssetKind,
  number
> = {
  image: 20 * 1024 * 1024,
  video: 50 * 1024 * 1024,
};

export const FILES_REMOTE_ASSET_MAX_URL_LENGTH = 4096;

export interface FilesRemoteAssetParams {
  destinationKey: string;
  fallbackContentType?: string;
  kind: FilesRemoteAssetKind;
  /**
   * The page the asset belongs to (its URL after redirects). The fetcher sends
   * its origin as the Referer, as a browser would, because some image hosts
   * refuse hotlinks without one. It never changes which hosts are allowed.
   */
  pageUrl?: string;
  url: string;
}

export type FilesRemoteAssetSkipReason =
  | "blocked_url"
  | "empty"
  | "fetch_failed"
  | "http_error"
  | "invalid_image"
  | "too_large"
  | "unsupported_type";

export type FilesRemoteAssetResult =
  | {
      contentType: string;
      height?: number;
      size: number;
      stored: true;
      width?: number;
    }
  | {
      reason: FilesRemoteAssetSkipReason;
      status?: number;
      stored: false;
    };

export const isRemoteAssetPageUrl = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > FILES_REMOTE_ASSET_MAX_URL_LENGTH
  ) {
    return false;
  }
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const IMAGE_EXTENSION_REGEX = /\.(png|jpe?g|webp|gif|avif|svg)(?:[?#]|$)/;
const VIDEO_EXTENSION_REGEX = /\.(mp4|mov|m4v)(?:[?#]|$)/;

const IMAGE_TYPES: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

const VIDEO_TYPES: Record<string, string> = {
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  mp4: "video/mp4",
};

export const guessImageContentType = (url: string): string | null => {
  const extension = url.toLowerCase().match(IMAGE_EXTENSION_REGEX)?.[1];
  return extension ? (IMAGE_TYPES[extension] ?? null) : null;
};

export const guessVideoContentType = (url: string): string | null => {
  const extension = url.toLowerCase().match(VIDEO_EXTENSION_REGEX)?.[1];
  return extension ? (VIDEO_TYPES[extension] ?? null) : null;
};

/** Types that say only "some bytes", so the URL decides instead. */
const GENERIC_CONTENT_TYPES = new Set([
  "application/octet-stream",
  "binary/octet-stream",
]);

const specificContentType = (headerValue: string | null) => {
  const type = headerValue?.split(";")[0]?.trim().toLowerCase();
  return type && !GENERIC_CONTENT_TYPES.has(type) ? type : undefined;
};

export const resolveRemoteAssetContentType = (
  headerValue: string | null,
  url: string,
  fallbackContentType?: string
): string | null =>
  specificContentType(headerValue) ||
  fallbackContentType ||
  guessImageContentType(url) ||
  guessVideoContentType(url);

export const isRemoteAssetContentTypeAllowed = (
  kind: FilesRemoteAssetKind,
  contentType: string
): boolean => contentType.startsWith(kind === "image" ? "image/" : "video/");
