import { Parser } from "htmlparser2";
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

export interface SocialFetchDeps {
  pinnedFetch?: PinnedFetch;
  resolveDns: DnsResolver;
  timeoutMs?: number;
}

export const SOCIAL_FETCH_TIMEOUT_MS = 10_000;
export const MAX_SOCIAL_JSON_BYTES = 1024 * 1024;
export const MAX_SOCIAL_MEDIA_ITEMS = 10;
export const SOCIAL_TITLE_MAX_LENGTH = 512;
export const SOCIAL_DESCRIPTION_MAX_LENGTH = 4000;
const SOCIAL_USER_AGENT = "TeakBot/1.0 (+https://teakvault.com)";

const MP4_PATH_REGEX = /\.mp4$/i;
const HIDDEN_TAGS = new Set(["script", "style"]);
const TRAILING_SLASH_REGEX = /\/+$/;

export interface SocialJsonResult<T> {
  data: T | null;
  status: number;
}

export const fetchSocialJson = async <T>(
  url: string,
  deps: SocialFetchDeps
): Promise<SocialJsonResult<T>> => {
  try {
    const { response } = await safeFetch(
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

export const htmlToText = (html: string | undefined): string | undefined => {
  if (!html) {
    return;
  }
  let text = "";
  let hiddenDepth = 0;
  const parser = new Parser(
    {
      onopentag(name) {
        if (HIDDEN_TAGS.has(name)) {
          hiddenDepth += 1;
        } else if (name === "br") {
          text += "\n";
        }
      },
      ontext(data) {
        if (hiddenDepth === 0) {
          text += data;
        }
      },
      onclosetag(name) {
        if (HIDDEN_TAGS.has(name)) {
          hiddenDepth = Math.max(0, hiddenDepth - 1);
          text += " ";
        } else if (name === "p") {
          text += "\n";
        }
      },
    },
    { decodeEntities: true }
  );
  parser.write(html);
  parser.end();
  return text.trim() || undefined;
};

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
