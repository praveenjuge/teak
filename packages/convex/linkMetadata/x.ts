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

export type XStatusMetadata = {
  author: string | undefined;
  canonicalUrl: string | undefined;
  description: string | undefined;
  faviconUrl: string | undefined;
  finalUrl: string;
  imageUrl: string | undefined;
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

const extractTweetText = (html: string | undefined): string | undefined => {
  if (!html) {
    return undefined;
  }

  const paragraphMatch = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  const rawText = paragraphMatch?.[1];
  if (!rawText) {
    return undefined;
  }

  return sanitizeText(stripHtml(rawText), 512);
};

const extractPublishedAt = (html: string | undefined): string | undefined => {
  if (!html) {
    return undefined;
  }

  const anchors = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)];
  const anchorText = anchors.at(-1)?.[1];
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

export const fetchXStatusMetadata = async (
  normalizedUrl: string
): Promise<XStatusMetadata | null> => {
  if (!isXStatusUrl(normalizedUrl)) {
    return null;
  }

  const payload = await fetchXOEmbed(normalizedUrl);
  if (!payload) {
    return null;
  }

  const authorName = sanitizeText(payload.author_name, 128);
  const authorHandle = extractAuthorHandle(
    sanitizeUrl(normalizedUrl, payload.author_url)
  );
  const publishedAt = extractPublishedAt(payload.html);
  const title = extractTweetText(payload.html);
  const resolvedUrl = sanitizeUrl(normalizedUrl, payload.url) ?? normalizedUrl;

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
    siteName: "X",
    publisher: "X",
    publishedAt,
    canonicalUrl: resolvedUrl,
    finalUrl: resolvedUrl,
    raw: undefined,
  };
};
