import { sanitizeText, sanitizeUrl } from "./parsing";
import type { ScrapeSelectorResult } from "./types";

export const X_HOSTNAMES = ["x.com", "twitter.com"] as const;
const X_OEMBED_ENDPOINTS = [
  "https://publish.x.com/oembed",
  "https://publish.twitter.com/oembed",
] as const;
const X_STATUS_PATH_REGEX = /\/status\/(\d+)(?:[/?#]|$)/i;

type XOEmbedResponse = {
  author_name?: string;
  author_url?: string;
  html?: string;
  url?: string;
};

type XSyndicationMediaVariant = {
  bitrate?: number;
  content_type?: string;
  url?: string;
};

type XSyndicationMediaDetail = {
  expanded_url?: string;
  media_url_https?: string;
  original_info?: {
    height?: number;
    width?: number;
  };
  type?: "photo" | "video" | "animated_gif";
  video_info?: {
    variants?: XSyndicationMediaVariant[];
  };
};

type XSyndicationUser = {
  name?: string;
  screen_name?: string;
};

type XSyndicationResponse = {
  created_at?: string;
  id_str?: string;
  mediaDetails?: XSyndicationMediaDetail[];
  text?: string;
  user?: XSyndicationUser;
};

export type XStatusMedia = {
  contentType?: string;
  height?: number;
  posterContentType?: string;
  posterHeight?: number;
  posterUrl?: string;
  posterWidth?: number;
  type: "image" | "video";
  url: string;
  width?: number;
};

export type XStatusMetadata = {
  author: string | undefined;
  canonicalUrl: string | undefined;
  description: string | undefined;
  faviconUrl: string | undefined;
  finalUrl: string;
  imageUrl: string | undefined;
  media: XStatusMedia[] | undefined;
  publishedAt: string | undefined;
  publisher: string | undefined;
  raw: ScrapeSelectorResult[] | undefined;
  siteName: string | undefined;
  title: string | undefined;
};

export const isXHostname = (hostname: string): boolean =>
  X_HOSTNAMES.some(
    (candidate) => hostname === candidate || hostname.endsWith(`.${candidate}`)
  );

export const isXUrl = (url: string): boolean => {
  try {
    return isXHostname(new URL(url).hostname);
  } catch {
    return false;
  }
};

export const extractXStatusId = (url: string): string | undefined => {
  try {
    const parsedUrl = new URL(url);
    if (!isXHostname(parsedUrl.hostname)) {
      return undefined;
    }
    const pathname = parsedUrl.pathname;
    return pathname.match(X_STATUS_PATH_REGEX)?.[1];
  } catch {
    return undefined;
  }
};

export const isXStatusUrl = (url: string): boolean =>
  Boolean(extractXStatusId(url));

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);/g, (_, num) =>
      String.fromCharCode(Number.parseInt(num, 10))
    )
    .replace(/&amp;/gi, "&");

const stripHtml = (value: string): string =>
  decodeHtmlEntities(value).replace(/<[^>]+>/g, " ");

const stripTrailingTcoLinks = (value: string | undefined): string | undefined =>
  value?.replace(/\s+https:\/\/t\.co\/[a-zA-Z0-9]+$/g, "").trim() || undefined;

const extractTweetText = (html: string | undefined): string | undefined => {
  if (!html) {
    return undefined;
  }

  const paragraphMatch = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  const rawText = paragraphMatch?.[1];
  if (!rawText) {
    return undefined;
  }

  return sanitizeText(stripTrailingTcoLinks(stripHtml(rawText)), 512);
};

const extractPublishedAt = (html: string | undefined): string | undefined => {
  if (!html) {
    return undefined;
  }

  const anchors = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)];
  const anchorText = anchors[anchors.length - 1]?.[1];
  return sanitizeText(anchorText ? stripHtml(anchorText) : undefined, 128);
};

const extractAuthorHandle = (
  authorUrl: string | undefined
): string | undefined => {
  if (!authorUrl) {
    return undefined;
  }

  try {
    const pathname = new URL(authorUrl).pathname.replace(/^\/+|\/+$/g, "");
    return sanitizeText(pathname || undefined, 64);
  } catch {
    return undefined;
  }
};

const formatPublishedAt = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return sanitizeText(value, 128);
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
};

const buildDescription = ({
  authorName,
  authorHandle,
  publishedAt,
}: {
  authorName?: string;
  authorHandle?: string;
  publishedAt?: string;
}): string | undefined => {
  const authorLabel = authorHandle
    ? authorName && authorName !== authorHandle
      ? `${authorName} (@${authorHandle})`
      : `@${authorHandle}`
    : authorName;

  if (!(authorLabel || publishedAt)) {
    return undefined;
  }

  return sanitizeText(
    [authorLabel ? `${authorLabel} on X` : "Post on X", publishedAt]
      .filter(Boolean)
      .join(" · "),
    256
  );
};

const isValidXOEmbed = (
  payload: XOEmbedResponse | null
): payload is XOEmbedResponse =>
  Boolean(payload && (payload.html || payload.url || payload.author_url));

const isValidXSyndication = (
  payload: XSyndicationResponse | null
): payload is XSyndicationResponse => Boolean(payload?.id_str);

const fetchXOEmbed = async (url: string): Promise<XOEmbedResponse | null> => {
  for (const endpoint of X_OEMBED_ENDPOINTS) {
    try {
      const response = await fetch(
        `${endpoint}?omit_script=true&url=${encodeURIComponent(url)}`,
        {
          headers: {
            accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as XOEmbedResponse;
      if (isValidXOEmbed(payload)) {
        return payload;
      }
    } catch (error) {
      console.warn(
        `[linkMetadata] Failed X oEmbed fetch via ${endpoint}`,
        error
      );
    }
  }

  return null;
};

const buildXMediaFromSyndication = (
  normalizedUrl: string,
  payload: XSyndicationResponse | null
): XStatusMedia[] | undefined => {
  if (!payload?.mediaDetails?.length) {
    return undefined;
  }

  const media: XStatusMedia[] = [];

  for (const item of payload.mediaDetails) {
    const width =
      typeof item.original_info?.width === "number"
        ? item.original_info.width
        : undefined;
    const height =
      typeof item.original_info?.height === "number"
        ? item.original_info.height
        : undefined;

    if (item.type === "photo") {
      const imageUrl = sanitizeUrl(normalizedUrl, item.media_url_https);
      if (imageUrl) {
        media.push({
          type: "image",
          url: imageUrl,
          contentType: "image/jpeg",
          width,
          height,
        });
      }
      continue;
    }

    if (item.type === "video" || item.type === "animated_gif") {
      const variants = item.video_info?.variants ?? [];
      const mp4Variants = variants
        .filter(
          (
            variant
          ): variant is XSyndicationMediaVariant & {
            content_type: string;
            url: string;
          } =>
            variant.content_type === "video/mp4" &&
            typeof variant.url === "string"
        )
        .sort((left, right) => (left.bitrate ?? 0) - (right.bitrate ?? 0));
      const mp4Variant = mp4Variants[mp4Variants.length - 1];

      const videoUrl = sanitizeUrl(normalizedUrl, mp4Variant?.url);
      if (!videoUrl) {
        continue;
      }

      const posterUrl = sanitizeUrl(normalizedUrl, item.media_url_https);

      media.push({
        type: "video",
        url: videoUrl,
        contentType: mp4Variant?.content_type,
        width,
        height,
        posterUrl: posterUrl ?? undefined,
        posterContentType: posterUrl ? "image/jpeg" : undefined,
        posterWidth: width,
        posterHeight: height,
      });
    }
  }

  return media.length ? media : undefined;
};

const fetchXSyndication = async (
  statusId: string
): Promise<XSyndicationResponse | null> => {
  try {
    const response = await fetch(
      `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(statusId)}&token=token`,
      {
        headers: {
          accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as XSyndicationResponse;
    return isValidXSyndication(payload) ? payload : null;
  } catch (error) {
    console.warn("[linkMetadata] Failed X syndication fetch", error);
    return null;
  }
};

export const fetchXStatusMetadata = async (
  normalizedUrl: string
): Promise<XStatusMetadata | null> => {
  const statusId = extractXStatusId(normalizedUrl);
  if (!statusId) {
    return null;
  }

  const [oEmbedPayload, syndicationPayload] = await Promise.all([
    fetchXOEmbed(normalizedUrl),
    fetchXSyndication(statusId),
  ]);

  if (!(oEmbedPayload || syndicationPayload)) {
    return null;
  }

  const authorName = sanitizeText(
    oEmbedPayload?.author_name ?? syndicationPayload?.user?.name,
    128
  );
  const authorUrl =
    sanitizeUrl(normalizedUrl, oEmbedPayload?.author_url) ??
    (syndicationPayload?.user?.screen_name
      ? `https://x.com/${syndicationPayload.user.screen_name}`
      : undefined);
  const authorHandle = extractAuthorHandle(
    sanitizeUrl(normalizedUrl, authorUrl)
  );
  const publishedAt =
    extractPublishedAt(oEmbedPayload?.html) ??
    formatPublishedAt(syndicationPayload?.created_at);
  const title =
    extractTweetText(oEmbedPayload?.html) ??
    sanitizeText(stripTrailingTcoLinks(syndicationPayload?.text), 512);
  const resolvedUrl =
    sanitizeUrl(normalizedUrl, oEmbedPayload?.url) ?? normalizedUrl;

  return {
    title,
    description: buildDescription({
      authorName,
      authorHandle,
      publishedAt,
    }),
    author: authorName ?? authorHandle,
    imageUrl: undefined,
    faviconUrl: undefined,
    media: buildXMediaFromSyndication(normalizedUrl, syndicationPayload),
    siteName: "X",
    publisher: "X",
    publishedAt,
    canonicalUrl: resolvedUrl,
    finalUrl: resolvedUrl,
    raw: undefined,
  };
};
