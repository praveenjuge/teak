import { sanitizeText, sanitizeUrl } from "./parsing";
import type { SocialPostMedia, SocialPostMetadata } from "./socialPost";
import {
  buildSocialPostText,
  fetchSocialJson,
  formatSocialByline,
  limitSocialMedia,
  type SocialFetchDeps,
  socialPostBase,
  toIsoDate,
} from "./socialPostHelpers";

const BLUESKY_HOSTS = ["bsky.app", "www.bsky.app"];
const BLUESKY_API = "https://public.api.bsky.app/xrpc";
const BLUESKY_POST_PATH_REGEX = /^\/profile\/([^/]+)\/post\/([a-z0-9]+)\/?$/i;
const NO_UNAUTHENTICATED_LABEL = "!no-unauthenticated";

interface BlueskyLabel {
  val?: string;
}

interface BlueskyImageView {
  alt?: string;
  aspectRatio?: { height?: number; width?: number };
  fullsize?: string;
  thumb?: string;
}

interface BlueskyEmbedView {
  $type?: string;
  aspectRatio?: { height?: number; width?: number };
  images?: BlueskyImageView[];
  /** A recordWithMedia embed keeps its images or video here. */
  media?: BlueskyEmbedView;
  thumbnail?: string;
}

interface BlueskyPostView {
  author?: {
    did?: string;
    displayName?: string;
    handle?: string;
    labels?: BlueskyLabel[];
  };
  embed?: BlueskyEmbedView;
  labels?: BlueskyLabel[];
  record?: { createdAt?: string; text?: string };
  uri?: string;
}

interface BlueskyThreadResponse {
  thread?: { $type?: string; post?: BlueskyPostView };
}

export interface BlueskyPostRef {
  actor: string;
  rkey: string;
}

/** `bsky.app/profile/<handle or did>/post/<rkey>`. */
export const parseBlueskyPostUrl = (url: string): BlueskyPostRef | null => {
  try {
    const parsed = new URL(url);
    if (!BLUESKY_HOSTS.includes(parsed.hostname.toLowerCase())) {
      return null;
    }
    const match = parsed.pathname.match(BLUESKY_POST_PATH_REGEX);
    if (!(match?.[1] && match[2])) {
      return null;
    }
    return { actor: decodeURIComponent(match[1]), rkey: match[2] };
  } catch {
    return null;
  }
};

export const isBlueskyPostUrl = (url: string): boolean =>
  parseBlueskyPostUrl(url) !== null;

const hasLabel = (labels: BlueskyLabel[] | undefined, value: string) =>
  Boolean(labels?.some((label) => label.val === value));

const blueskyMedia = (
  url: string,
  embed: BlueskyEmbedView | undefined
): SocialPostMedia[] => {
  if (!embed) {
    return [];
  }
  if (embed.media) {
    return blueskyMedia(url, embed.media);
  }
  if (embed.$type?.startsWith("app.bsky.embed.images")) {
    return (embed.images ?? []).flatMap((image) => {
      const imageUrl = sanitizeUrl(url, image.fullsize ?? image.thumb);
      return imageUrl
        ? [
            {
              type: "image" as const,
              url: imageUrl,
              contentType: "image/jpeg",
              width: image.aspectRatio?.width,
              height: image.aspectRatio?.height,
            },
          ]
        : [];
    });
  }
  // Bluesky video is an HLS stream; keep its thumbnail as the poster image.
  if (embed.$type?.startsWith("app.bsky.embed.video")) {
    const posterUrl = sanitizeUrl(url, embed.thumbnail);
    return posterUrl
      ? [
          {
            type: "image",
            url: posterUrl,
            contentType: "image/jpeg",
            width: embed.aspectRatio?.width,
            height: embed.aspectRatio?.height,
          },
        ]
      : [];
  }
  return [];
};

const resolveBlueskyDid = async (
  actor: string,
  deps: SocialFetchDeps
): Promise<string | null> => {
  if (actor.startsWith("did:")) {
    return actor;
  }
  const { data } = await fetchSocialJson<{ did?: string }>(
    `${BLUESKY_API}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(actor)}`,
    deps
  );
  return typeof data?.did === "string" && data.did.startsWith("did:")
    ? data.did
    : null;
};

/**
 * A public Bluesky post from the AppView API: resolve the handle, then read
 * the post with no replies or parents. Private (`!no-unauthenticated`),
 * deleted and unreachable posts return null.
 */
export const fetchBlueskyPost = async (
  url: string,
  deps: SocialFetchDeps
): Promise<SocialPostMetadata | null> => {
  const ref = parseBlueskyPostUrl(url);
  if (!ref) {
    return null;
  }
  const did = await resolveBlueskyDid(ref.actor, deps);
  if (!did) {
    return null;
  }
  const uri = `at://${did}/app.bsky.feed.post/${ref.rkey}`;
  const { data } = await fetchSocialJson<BlueskyThreadResponse>(
    `${BLUESKY_API}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0&parentHeight=0`,
    deps
  );
  const post = data?.thread?.post;
  if (!(post?.record && data?.thread?.$type?.endsWith("#threadViewPost"))) {
    return null;
  }
  if (
    hasLabel(post.author?.labels, NO_UNAUTHENTICATED_LABEL) ||
    hasLabel(post.labels, NO_UNAUTHENTICATED_LABEL)
  ) {
    return null;
  }

  const authorName = sanitizeText(post.author?.displayName, 128);
  const handle = sanitizeText(post.author?.handle, 128);
  const authorHandle = handle ? `@${handle}` : undefined;
  const publishedAt = toIsoDate(post.record.createdAt);
  const { title, description } = buildSocialPostText(
    post.record.text,
    formatSocialByline({
      authorName,
      authorHandle,
      publishedAt,
      siteName: "Bluesky",
    })
  );

  return socialPostBase(url, {
    author: authorName ?? authorHandle,
    description,
    media: limitSocialMedia(blueskyMedia(url, post.embed)),
    platform: "bluesky",
    publishedAt,
    siteName: "Bluesky",
    title,
  });
};
