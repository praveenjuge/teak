import { fetchBlueskyPost, isBlueskyPostUrl } from "./bluesky";
import { mapLinkedInOpenGraph } from "./linkedin";
import { fetchMastodonStatus, isMastodonStatusUrl } from "./mastodon";
import { fetchRedditPost, isRedditPostUrl } from "./reddit";
import type { SocialFetchDeps } from "./socialPostHelpers";
import { mapSubstackNoteOpenGraph } from "./substackNotes";
import { mapThreadsOpenGraph } from "./threads";
import { fetchTikTokVideo, isTikTokVideoUrl } from "./tiktok";
import type { LinkPreviewMetadata, ScrapeSelectorResult } from "./types";

export type SocialPlatform =
  | "bluesky"
  | "linkedin"
  | "mastodon"
  | "reddit"
  | "substack_notes"
  | "threads"
  | "tiktok"
  | "x";

export interface SocialPostMedia {
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

/**
 * A post as read from its site, shaped for `buildSuccessPreview`. The title is
 * the post text (at most 512 characters) and the media are direct image and
 * MP4 URLs still to be stored.
 */
export interface SocialPostMetadata {
  author: string | undefined;
  canonicalUrl: string | undefined;
  /** Saved on the preview; categorization prefers it to the URL rules. */
  categoryHint?: "social_post";
  description: string | undefined;
  faviconUrl: string | undefined;
  finalUrl: string;
  imageUrl: string | undefined;
  media: SocialPostMedia[] | undefined;
  platform?: SocialPlatform;
  publishedAt: string | undefined;
  publisher: string | undefined;
  raw: ScrapeSelectorResult[] | undefined;
  siteName: string | undefined;
  title: string | undefined;
}

/** The page fields the generic scrape parsed (`parseLinkPreview`). */
export type ParsedLinkPreview = Partial<
  Pick<
    LinkPreviewMetadata,
    | "author"
    | "canonicalUrl"
    | "description"
    | "faviconUrl"
    | "finalUrl"
    | "imageUrl"
    | "publishedAt"
    | "publisher"
    | "raw"
    | "siteName"
    | "title"
  >
>;

/**
 * Bluesky, Mastodon, Reddit and TikTok posts read from their public APIs
 * (oEmbed for TikTok). Runs after the X branch and before the page scrape;
 * null (no match, private, deleted, rate-limited, timed out) means scrape the
 * page as usual. Never throws.
 */
export const fetchSocialPostMetadata = async (
  url: string,
  deps: SocialFetchDeps
): Promise<SocialPostMetadata | null> => {
  try {
    if (isBlueskyPostUrl(url)) {
      return await fetchBlueskyPost(url, deps);
    }
    if (isRedditPostUrl(url)) {
      return await fetchRedditPost(url, deps);
    }
    if (isTikTokVideoUrl(url)) {
      return await fetchTikTokVideo(url, deps);
    }
    if (isMastodonStatusUrl(url)) {
      return await fetchMastodonStatus(url, deps);
    }
  } catch (error) {
    console.warn("[linkMetadata] Social post lookup failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return null;
};

/**
 * Threads, LinkedIn and Substack Notes posts from the Open Graph tags the
 * generic scrape already read; no request of its own.
 */
export const mapOpenGraphSocialPost = (
  url: string,
  parsed: ParsedLinkPreview
): SocialPostMetadata | null =>
  mapThreadsOpenGraph(url, parsed) ??
  mapLinkedInOpenGraph(url, parsed) ??
  mapSubstackNoteOpenGraph(url, parsed);

/** The post as preview fields: everything but the platform name. */
export const toSocialPostPreviewFields = ({
  platform: _platform,
  media: _media,
  ...fields
}: SocialPostMetadata) => fields;
