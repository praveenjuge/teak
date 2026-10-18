import { sanitizeText, sanitizeUrl } from "./parsing";
import type { SocialPostMedia, SocialPostMetadata } from "./socialPost";
import {
  buildSocialPostText,
  fetchSocialJson,
  formatSocialByline,
  htmlToText,
  isDirectMp4Url,
  limitSocialMedia,
  type SocialFetchDeps,
  sameSocialUrl,
  socialPostBase,
  toIsoDate,
} from "./socialPostHelpers";

const MASTODON_STATUS_PATH_REGEX = /^\/@([^/@]+)\/(\d+)\/?$/;

interface MastodonMediaSize {
  height?: number;
  width?: number;
}

interface MastodonAttachment {
  meta?: { original?: MastodonMediaSize; small?: MastodonMediaSize };
  preview_url?: string;
  type?: "image" | "gifv" | "video" | "audio" | "unknown";
  url?: string;
}

interface MastodonStatus {
  account?: { acct?: string; display_name?: string; username?: string };
  content?: string;
  created_at?: string;
  id?: string;
  media_attachments?: MastodonAttachment[];
  spoiler_text?: string;
  url?: string;
}

export interface MastodonStatusRef {
  id: string;
  origin: string;
  user: string;
}

/**
 * `https://<any host>/@<user>/<id>`. The path is all there is to go on, so a
 * match only means "worth asking": the status API has to confirm it.
 */
export const parseMastodonStatusUrl = (
  url: string
): MastodonStatusRef | null => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return null;
    }
    const match = parsed.pathname.match(MASTODON_STATUS_PATH_REGEX);
    if (!(match?.[1] && match[2])) {
      return null;
    }
    return { origin: parsed.origin, user: match[1], id: match[2] };
  } catch {
    return null;
  }
};

export const isMastodonStatusUrl = (url: string): boolean =>
  parseMastodonStatusUrl(url) !== null;

const mastodonMedia = (
  url: string,
  attachment: MastodonAttachment
): SocialPostMedia | null => {
  const size = attachment.meta?.original;
  const posterUrl = sanitizeUrl(url, attachment.preview_url);
  if (attachment.type === "image") {
    const imageUrl = sanitizeUrl(url, attachment.url);
    return imageUrl
      ? {
          type: "image",
          url: imageUrl,
          width: size?.width,
          height: size?.height,
        }
      : null;
  }
  if (attachment.type === "gifv" || attachment.type === "video") {
    const videoUrl = sanitizeUrl(url, attachment.url);
    if (isDirectMp4Url(videoUrl)) {
      return {
        type: "video",
        url: videoUrl,
        contentType: "video/mp4",
        width: size?.width,
        height: size?.height,
        posterUrl,
        posterWidth: attachment.meta?.small?.width,
        posterHeight: attachment.meta?.small?.height,
      };
    }
    return posterUrl ? { type: "image", url: posterUrl } : null;
  }
  return null;
};

/**
 * Any host can answer `/api/v1/statuses/:id`: the answer only counts when it
 * names this very URL as the status's own.
 */
export const fetchMastodonStatus = async (
  url: string,
  deps: SocialFetchDeps
): Promise<SocialPostMetadata | null> => {
  const ref = parseMastodonStatusUrl(url);
  if (!ref) {
    return null;
  }
  const { data: status } = await fetchSocialJson<MastodonStatus>(
    `${ref.origin}/api/v1/statuses/${ref.id}`,
    deps
  );
  if (
    !(status?.url && status.id === ref.id && sameSocialUrl(status.url, url))
  ) {
    return null;
  }

  const host = new URL(url).hostname;
  const account = status.account;
  const authorName = sanitizeText(account?.display_name, 128);
  const acct = account?.acct ?? account?.username ?? ref.user;
  const authorHandle = sanitizeText(
    acct.includes("@") ? `@${acct}` : `@${acct}@${host}`,
    128
  );
  const publishedAt = toIsoDate(status.created_at);
  const content = htmlToText(status.content);
  const warning = sanitizeText(status.spoiler_text, 256);
  const text = warning ? `CW: ${warning}\n\n${content ?? ""}` : content;
  const { title, description } = buildSocialPostText(
    text,
    formatSocialByline({
      authorName,
      authorHandle,
      publishedAt,
      siteName: "Mastodon",
    })
  );

  return socialPostBase(url, {
    author: authorName ?? authorHandle,
    description,
    media: limitSocialMedia(
      (status.media_attachments ?? [])
        .map((attachment) => mastodonMedia(url, attachment))
        .filter((item): item is SocialPostMedia => item !== null)
    ),
    platform: "mastodon",
    publishedAt,
    siteName: "Mastodon",
    title,
  });
};
