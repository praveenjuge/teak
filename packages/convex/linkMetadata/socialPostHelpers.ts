import { sanitizeText } from "./parsing";
import type {
  ParsedLinkPreview,
  SocialPlatform,
  SocialPostMedia,
  SocialPostMetadata,
} from "./socialPost";
import {
  type DnsResolver,
  type PinnedFetch,
  readBodyWithLimit,
  safeFetch,
} from "./ssrf";

/** The SSRF-checked transport every social post request goes through. */
export interface SocialFetchDeps {
  pinnedFetch?: PinnedFetch;
  resolveDns: DnsResolver;
  /** Per-request timeout; defaults to {@link SOCIAL_FETCH_TIMEOUT_MS}. */
  timeoutMs?: number;
}

export const SOCIAL_FETCH_TIMEOUT_MS = 10_000;
export const MAX_SOCIAL_JSON_BYTES = 1024 * 1024;
export const MAX_SOCIAL_MEDIA_ITEMS = 10;
export const SOCIAL_TITLE_MAX_LENGTH = 512;
export const SOCIAL_DESCRIPTION_MAX_LENGTH = 4000;
const SOCIAL_USER_AGENT = "TeakBot/1.0 (+https://teakvault.com)";

const MP4_PATH_REGEX = /\.mp4$/i;
const SCRIPT_OR_STYLE_REGEX = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const BLOCK_BREAK_REGEX = /<br\s*\/?>|<\/p\s*>/gi;
const TAG_REGEX = /<[^>]+>/g;
const HEX_ENTITY_REGEX = /&#x([0-9a-f]+);/gi;
const DECIMAL_ENTITY_REGEX = /&#([0-9]+);/g;
const TRAILING_SLASH_REGEX = /\/+$/;

export interface SocialJsonResult<T> {
  data: T | null;
  /** The HTTP status, or 0 when the request never got an answer. */
  status: number;
}

/**
 * GET a JSON document through `safeFetch` (every hop checked against the
 * SSRF policy, connections pinned), with a 10 s timeout and a 1 MiB body
 * cap. Never throws: any failure reads as `data: null`.
 */
export const fetchSocialJson = async <T>(
  url: string,
  deps: SocialFetchDeps
): Promise<SocialJsonResult<T>> => {
  try {
    const response = await safeFetch(
      url,
      deps.resolveDns,
      {
        headers: {
          accept: "application/json",
          "user-agent": SOCIAL_USER_AGENT,
        },
        signal: AbortSignal.timeout(deps.timeoutMs ?? SOCIAL_FETCH_TIMEOUT_MS),
      },
      deps.pinnedFetch
    );
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { data: null, status: response.status };
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (declaredLength > MAX_SOCIAL_JSON_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      return { data: null, status: response.status };
    }
    const body = await readBodyWithLimit(response, MAX_SOCIAL_JSON_BYTES);
    return {
      data: JSON.parse(new TextDecoder().decode(body)) as T,
      status: response.status,
    };
  } catch (error) {
    console.warn("[linkMetadata] Social post fetch failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { data: null, status: 0 };
  }
};

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(HEX_ENTITY_REGEX, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(DECIMAL_ENTITY_REGEX, (_, num) =>
      String.fromCodePoint(Number.parseInt(num, 10))
    )
    .replace(/&amp;/gi, "&");

/** Post HTML (Mastodon `content`) as plain text; scripts and styles drop. */
export const htmlToText = (html: string | undefined): string | undefined => {
  if (!html) {
    return;
  }
  const text = decodeHtmlEntities(
    html
      .replace(SCRIPT_OR_STYLE_REGEX, " ")
      .replace(BLOCK_BREAK_REGEX, "\n")
      .replace(TAG_REGEX, "")
  ).trim();
  return text || undefined;
};

/** A date as ISO 8601, or undefined when it doesn't parse. */
export const toIsoDate = (
  value: string | number | undefined
): string | undefined => {
  if (value === undefined || value === "") {
    return;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const BYLINE_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "Ada (@ada) on Bluesky · June 1, 2026", as X posts read. */
export const formatSocialByline = ({
  authorName,
  authorHandle,
  publishedAt,
  siteName,
}: {
  authorName?: string;
  authorHandle?: string;
  publishedAt?: string;
  siteName: string;
}): string | undefined => {
  let author = authorName;
  if (authorHandle) {
    author =
      authorName && authorName !== authorHandle
        ? `${authorName} (${authorHandle})`
        : authorHandle;
  }
  const date = publishedAt ? new Date(publishedAt) : undefined;
  const dateLabel =
    date && !Number.isNaN(date.getTime())
      ? BYLINE_DATE_FORMAT.format(date)
      : undefined;
  if (!(author || dateLabel)) {
    return;
  }
  return sanitizeText(
    [author ? `${author} on ${siteName}` : `Post on ${siteName}`, dateLabel]
      .filter(Boolean)
      .join(" · "),
    256
  );
};

/**
 * The title is the post text cut at 512 characters. The description is the
 * whole text (up to 4,000) when the title had to cut it, else the byline.
 */
export const buildSocialPostText = (
  text: string | undefined,
  byline: string | undefined
): { description: string | undefined; title: string | undefined } => {
  const title = sanitizeText(text, SOCIAL_TITLE_MAX_LENGTH);
  const fullText = sanitizeText(text, SOCIAL_DESCRIPTION_MAX_LENGTH);
  return {
    title,
    description:
      fullText && title && fullText.length > title.length ? fullText : byline,
  };
};

/** A direct MP4 file (not an HLS or DASH manifest). */
export const isDirectMp4Url = (url: string | undefined): url is string => {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      MP4_PATH_REGEX.test(parsed.pathname)
    );
  } catch {
    return false;
  }
};

/** Only http(s) media URLs, at most ten of them. */
export const limitSocialMedia = (
  media: SocialPostMedia[]
): SocialPostMedia[] | undefined => {
  const kept = media
    .filter((item) => {
      try {
        const { protocol } = new URL(item.url);
        return protocol === "https:" || protocol === "http:";
      } catch {
        return false;
      }
    })
    .slice(0, MAX_SOCIAL_MEDIA_ITEMS);
  return kept.length ? kept : undefined;
};

/** Host and path compared without case on the host, query, hash or a trailing slash. */
export const sameSocialUrl = (left: string, right: string): boolean => {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return (
      a.host.toLowerCase() === b.host.toLowerCase() &&
      a.pathname.replace(TRAILING_SLASH_REGEX, "") ===
        b.pathname.replace(TRAILING_SLASH_REGEX, "")
    );
  } catch {
    return false;
  }
};

/**
 * A post from the Open Graph tags the page scrape read: `og:description` is
 * the text (or the title, where the site puts the text there) and `og:image`
 * its one image. Null without text, which is what a login wall leaves.
 */
export const openGraphSocialPost = (
  url: string,
  parsed: ParsedLinkPreview,
  {
    authorHandle,
    authorName,
    platform,
    siteName,
    textFromTitle = false,
  }: {
    authorHandle?: string;
    authorName?: string;
    platform: SocialPlatform;
    siteName: string;
    textFromTitle?: boolean;
  }
): SocialPostMetadata | null => {
  const text = parsed.description ?? (textFromTitle ? parsed.title : undefined);
  if (!text) {
    return null;
  }
  const publishedAt = toIsoDate(parsed.publishedAt) ?? parsed.publishedAt;
  const { title, description } = buildSocialPostText(
    text,
    formatSocialByline({ authorName, authorHandle, publishedAt, siteName })
  );
  const imageUrl = parsed.imageUrl?.startsWith("data:")
    ? undefined
    : parsed.imageUrl;
  return {
    author: authorName ?? authorHandle ?? parsed.author,
    canonicalUrl: parsed.canonicalUrl,
    categoryHint: "social_post",
    description,
    faviconUrl: parsed.faviconUrl,
    finalUrl: parsed.finalUrl ?? url,
    imageUrl: parsed.imageUrl,
    media: limitSocialMedia(imageUrl ? [{ type: "image", url: imageUrl }] : []),
    platform,
    publishedAt,
    publisher: siteName,
    raw: parsed.raw,
    siteName,
    title,
  };
};

/** The fields every API-backed post shares; the caller supplies the rest. */
export const socialPostBase = (
  url: string,
  post: Pick<
    SocialPostMetadata,
    | "author"
    | "description"
    | "media"
    | "platform"
    | "publishedAt"
    | "siteName"
    | "title"
  >
): SocialPostMetadata => ({
  ...post,
  canonicalUrl: url,
  categoryHint: "social_post",
  faviconUrl: undefined,
  finalUrl: url,
  imageUrl: undefined,
  publisher: post.siteName,
  raw: undefined,
});
