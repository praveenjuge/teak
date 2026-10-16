import { sanitizeText, sanitizeUrl } from "./parsing";
import type { SocialPostMetadata } from "./socialPost";
import {
  buildSocialPostText,
  fetchSocialJson,
  formatSocialByline,
  limitSocialMedia,
  type SocialFetchDeps,
  socialPostBase,
  toIsoDate,
} from "./socialPostHelpers";

const TIKTOK_HOST_REGEX = /(^|\.)tiktok\.com$/i;
const TIKTOK_VIDEO_PATH_REGEX = /^\/@([^/]+)\/video\/(\d+)\/?$/;
const TIKTOK_OEMBED = "https://www.tiktok.com/oembed";

interface TikTokOEmbed {
  author_name?: string;
  author_unique_id?: string;
  thumbnail_height?: number;
  thumbnail_url?: string;
  thumbnail_width?: number;
  title?: string;
}

export interface TikTokVideoRef {
  handle: string;
  id: string;
}

/** `tiktok.com/@<user>/video/<id>`. */
export const parseTikTokVideoUrl = (url: string): TikTokVideoRef | null => {
  try {
    const parsed = new URL(url);
    if (!TIKTOK_HOST_REGEX.test(parsed.hostname)) {
      return null;
    }
    const match = parsed.pathname.match(TIKTOK_VIDEO_PATH_REGEX);
    return match?.[1] && match[2] ? { handle: match[1], id: match[2] } : null;
  } catch {
    return null;
  }
};

export const isTikTokVideoUrl = (url: string): boolean =>
  parseTikTokVideoUrl(url) !== null;

/** TikTok ids carry their creation time in seconds in the top 32 bits. */
export const tikTokIdToIsoDate = (id: string): string | undefined => {
  try {
    const seconds = Number(BigInt(id) / BigInt(2 ** 32));
    return seconds > 0 ? toIsoDate(seconds * 1000) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * A TikTok video from oEmbed: its caption, author and cover image. The video
 * itself is not downloaded.
 */
export const fetchTikTokVideo = async (
  url: string,
  deps: SocialFetchDeps
): Promise<SocialPostMetadata | null> => {
  const ref = parseTikTokVideoUrl(url);
  if (!ref) {
    return null;
  }
  const { data } = await fetchSocialJson<TikTokOEmbed>(
    `${TIKTOK_OEMBED}?url=${encodeURIComponent(url)}`,
    deps
  );
  if (!data) {
    return null;
  }
  const authorName = sanitizeText(data.author_name, 128);
  const handle = sanitizeText(data.author_unique_id ?? ref.handle, 128);
  const authorHandle = handle ? `@${handle}` : undefined;
  const publishedAt = tikTokIdToIsoDate(ref.id);
  const posterUrl = sanitizeUrl(url, data.thumbnail_url);
  const { title, description } = buildSocialPostText(
    data.title,
    formatSocialByline({
      authorName,
      authorHandle,
      publishedAt,
      siteName: "TikTok",
    })
  );
  if (!(title || posterUrl)) {
    return null;
  }

  return socialPostBase(url, {
    author: authorName ?? authorHandle,
    description,
    media: limitSocialMedia(
      posterUrl
        ? [
            {
              type: "image",
              url: posterUrl,
              width: data.thumbnail_width,
              height: data.thumbnail_height,
            },
          ]
        : []
    ),
    platform: "tiktok",
    publishedAt,
    siteName: "TikTok",
    title,
  });
};
