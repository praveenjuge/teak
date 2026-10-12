import { sanitizeUrl } from "./parsing";

export const INSTAGRAM_HOSTNAME = "instagram.com";
export const INSTAGRAM_MEDIA_MIN_DIM = 200;
const INSTAGRAM_POST_PATH_REGEX = /^\/(p|reel)\/([A-Za-z0-9_-]+)(?:[/?#]|$)/i;

export interface InstagramPostMedia {
  contentType?: string;
  height?: number;
  posterContentType?: string;
  posterHeight?: number;
  posterUrl?: string;
  posterWidth?: number;
  type: "image" | "video";
  url: string;
  width?: number;
}

export const isInstagramHostname = (hostname: string): boolean =>
  hostname === INSTAGRAM_HOSTNAME ||
  hostname.endsWith(`.${INSTAGRAM_HOSTNAME}`);

export const isInstagramUrl = (url: string): boolean => {
  try {
    return isInstagramHostname(new URL(url).hostname);
  } catch {
    return false;
  }
};

export const extractInstagramPostCode = (url: string): string | undefined => {
  try {
    const parsedUrl = new URL(url);
    if (!isInstagramHostname(parsedUrl.hostname)) {
      return undefined;
    }

    return parsedUrl.pathname.match(INSTAGRAM_POST_PATH_REGEX)?.[2];
  } catch {
    return undefined;
  }
};

export const isInstagramPostUrl = (url: string): boolean =>
  Boolean(extractInstagramPostCode(url));

const sanitizeDimension = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;

const sanitizeContentType = (
  value: unknown,
  expectedPrefix: "image/" | "video/"
): string | undefined =>
  typeof value === "string" && value.toLowerCase().startsWith(expectedPrefix)
    ? value.split(";")[0]?.trim() || value
    : undefined;

const inferMediaType = (
  candidate: Record<string, unknown>
): "image" | "video" | undefined => {
  if (candidate.type === "image" || candidate.type === "video") {
    return candidate.type;
  }

  const contentType =
    typeof candidate.contentType === "string"
      ? candidate.contentType.toLowerCase()
      : "";

  const url =
    typeof candidate.url === "string" ? candidate.url.toLowerCase() : "";

  if (
    contentType.startsWith("video/") ||
    /\.(mp4|mov|m4v)(?:[?#]|$)/i.test(url)
  ) {
    return "video";
  }

  if (
    contentType.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|avif)(?:[?#]|$)/i.test(url)
  ) {
    return "image";
  }

  return undefined;
};

export const normalizeInstagramExtractedMedia = (
  normalizedUrl: string,
  media: unknown
): InstagramPostMedia[] | undefined => {
  if (!Array.isArray(media)) {
    return undefined;
  }

  const normalized: InstagramPostMedia[] = [];
  const seen = new Set<string>();

  for (const item of media) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as Record<string, unknown>;
    const type = inferMediaType(candidate);
    if (!type) {
      continue;
    }

    const url = sanitizeUrl(normalizedUrl, String(candidate.url ?? ""));
    if (!url) {
      continue;
    }

    const dedupeKey = `${type}:${url}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const width = sanitizeDimension(candidate.width);
    const height = sanitizeDimension(candidate.height);

    if (type === "image") {
      normalized.push({
        type,
        url,
        contentType: sanitizeContentType(candidate.contentType, "image/"),
        width,
        height,
      });
      continue;
    }

    const posterUrl = sanitizeUrl(
      normalizedUrl,
      typeof candidate.posterUrl === "string" ? candidate.posterUrl : undefined
    );

    normalized.push({
      type,
      url,
      contentType: sanitizeContentType(candidate.contentType, "video/"),
      width,
      height,
      posterUrl,
      posterContentType:
        sanitizeContentType(candidate.posterContentType, "image/") ??
        (posterUrl ? "image/jpeg" : undefined),
      posterWidth: sanitizeDimension(candidate.posterWidth),
      posterHeight: sanitizeDimension(candidate.posterHeight),
    });
  }

  return normalized.length ? normalized : undefined;
};
