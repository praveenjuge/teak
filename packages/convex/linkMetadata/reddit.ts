import { sanitizeText, sanitizeUrl } from "./parsing";
import type { SocialPostMedia, SocialPostMetadata } from "./socialPost";
import {
  buildSocialPostText,
  fetchSocialJson,
  formatSocialByline,
  isDirectMp4Url,
  limitSocialMedia,
  type SocialFetchDeps,
  socialPostBase,
  toIsoDate,
} from "./socialPostHelpers";

const REDDIT_HOST_REGEX = /(^|\.)reddit\.com$/i;
const REDDIT_POST_PATH_REGEX =
  /^((?:\/r\/[^/]+)?\/comments\/[a-z0-9]+)(?:\/[^/]*)?\/?$/i;
const REDDIT_ORIGIN = "https://www.reddit.com";
/** Reddit refuses some server traffic; oEmbed answers more often. */
const REDDIT_OEMBED_STATUSES = new Set([403, 429]);

interface RedditImageSource {
  height?: number;
  u?: string;
  url?: string;
  width?: number;
  x?: number;
  y?: number;
}

interface RedditPost {
  author?: string;
  created_utc?: number;
  gallery_data?: { items?: { media_id?: string }[] };
  media?: {
    reddit_video?: {
      fallback_url?: string;
      height?: number;
      width?: number;
    };
  };
  media_metadata?: Record<
    string,
    { e?: string; m?: string; s?: RedditImageSource; status?: string }
  >;
  post_hint?: string;
  preview?: { images?: { source?: RedditImageSource }[] };
  removed_by_category?: string | null;
  selftext?: string;
  subreddit?: string;
  title?: string;
  url_overridden_by_dest?: string;
}

type RedditListing = { data?: { children?: { data?: RedditPost }[] } }[];

interface RedditOEmbed {
  author_name?: string;
  title?: string;
}

/** The post's `/r/<sub>/comments/<id>` path, without the slug. */
export const parseRedditPostPath = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    if (!REDDIT_HOST_REGEX.test(parsed.hostname)) {
      return null;
    }
    return parsed.pathname.match(REDDIT_POST_PATH_REGEX)?.[1] ?? null;
  } catch {
    return null;
  }
};

export const isRedditPostUrl = (url: string): boolean =>
  parseRedditPostPath(url) !== null;

const galleryMedia = (url: string, post: RedditPost): SocialPostMedia[] =>
  (post.gallery_data?.items ?? []).flatMap((item) => {
    const entry = item.media_id
      ? post.media_metadata?.[item.media_id]
      : undefined;
    if (entry?.status !== "valid" || entry.e !== "Image") {
      return [];
    }
    const imageUrl = sanitizeUrl(url, entry.s?.u);
    return imageUrl
      ? [
          {
            type: "image" as const,
            url: imageUrl,
            contentType: entry.m,
            width: entry.s?.x,
            height: entry.s?.y,
          },
        ]
      : [];
  });

const redditMedia = (url: string, post: RedditPost): SocialPostMedia[] => {
  const gallery = galleryMedia(url, post);
  if (gallery.length) {
    return gallery;
  }
  const preview = post.preview?.images?.[0]?.source;
  const previewUrl = sanitizeUrl(url, preview?.url);
  const video = post.media?.reddit_video;
  const videoUrl = sanitizeUrl(url, video?.fallback_url);
  if (isDirectMp4Url(videoUrl)) {
    return [
      {
        type: "video",
        url: videoUrl,
        contentType: "video/mp4",
        width: video?.width,
        height: video?.height,
        posterUrl: previewUrl,
        posterWidth: preview?.width,
        posterHeight: preview?.height,
      },
    ];
  }
  return previewUrl
    ? [
        {
          type: "image",
          url: previewUrl,
          width: preview?.width,
          height: preview?.height,
        },
      ]
    : [];
};

const redditByline = (author?: string, subreddit?: string, date?: string) =>
  formatSocialByline({
    authorHandle: author ? `u/${author}` : undefined,
    publishedAt: date,
    siteName: subreddit ? `r/${subreddit}` : "Reddit",
  });

const fromRedditJson = (url: string, post: RedditPost): SocialPostMetadata => {
  const author = sanitizeText(post.author, 64);
  const subreddit = sanitizeText(post.subreddit, 64);
  const publishedAt =
    typeof post.created_utc === "number"
      ? toIsoDate(post.created_utc * 1000)
      : undefined;
  const text = [post.title, post.selftext].filter(Boolean).join("\n\n");
  const { title, description } = buildSocialPostText(
    text,
    redditByline(author, subreddit, publishedAt)
  );
  return socialPostBase(url, {
    author: author ? `u/${author}` : undefined,
    description,
    media: limitSocialMedia(redditMedia(url, post)),
    platform: "reddit",
    publishedAt,
    siteName: "Reddit",
    title,
  });
};

const fetchRedditOEmbed = async (
  url: string,
  deps: SocialFetchDeps
): Promise<SocialPostMetadata | null> => {
  const { data } = await fetchSocialJson<RedditOEmbed>(
    `${REDDIT_ORIGIN}/oembed?url=${encodeURIComponent(url)}`,
    deps
  );
  const postTitle = sanitizeText(data?.title, 512);
  if (!postTitle) {
    return null;
  }
  const author = sanitizeText(data?.author_name, 64);
  const { title, description } = buildSocialPostText(
    postTitle,
    redditByline(author)
  );
  return socialPostBase(url, {
    author: author ? `u/${author}` : undefined,
    description,
    media: undefined,
    platform: "reddit",
    publishedAt: undefined,
    siteName: "Reddit",
    title,
  });
};

/**
 * A Reddit post from its `.json` listing: title and text, author, subreddit,
 * date, and its gallery, image or video. When Reddit turns the request away
 * (403, 429) oEmbed gives the title and author; a removed post returns null.
 */
export const fetchRedditPost = async (
  url: string,
  deps: SocialFetchDeps
): Promise<SocialPostMetadata | null> => {
  const path = parseRedditPostPath(url);
  if (!path) {
    return null;
  }
  const { data, status } = await fetchSocialJson<RedditListing>(
    `${REDDIT_ORIGIN}${path}.json?raw_json=1`,
    deps
  );
  if (!data) {
    return REDDIT_OEMBED_STATUSES.has(status)
      ? await fetchRedditOEmbed(url, deps)
      : null;
  }
  const post = Array.isArray(data)
    ? data[0]?.data?.children?.[0]?.data
    : undefined;
  if (!post?.title || post.removed_by_category) {
    return null;
  }
  return fromRedditJson(url, post);
};
