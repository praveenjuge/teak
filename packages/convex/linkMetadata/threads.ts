import { sanitizeText } from "./parsing";
import type { ParsedLinkPreview, SocialPostMetadata } from "./socialPost";
import { openGraphSocialPost } from "./socialPostHelpers";

const THREADS_HOST_REGEX = /(^|\.)threads\.(net|com)$/i;
const THREADS_POST_PATH_REGEX = /^\/@([^/]+)\/post\/[^/]+\/?$/;
// og:title reads "Ada Lovelace (@ada) on Threads".
const THREADS_TITLE_REGEX = /^(.+?)\s*\(@[^)]+\)\s+on Threads/i;

/** The author's handle from `threads.net/@<user>/post/<id>`. */
export const parseThreadsPostUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    if (!THREADS_HOST_REGEX.test(parsed.hostname)) {
      return null;
    }
    return parsed.pathname.match(THREADS_POST_PATH_REGEX)?.[1] ?? null;
  } catch {
    return null;
  }
};

export const isThreadsPostUrl = (url: string): boolean =>
  parseThreadsPostUrl(url) !== null;

/**
 * A Threads post from its Open Graph tags. Threads' oEmbed needs an app
 * token, so the page scrape is the only source.
 */
export const mapThreadsOpenGraph = (
  url: string,
  parsed: ParsedLinkPreview
): SocialPostMetadata | null => {
  const handle = parseThreadsPostUrl(url);
  if (!handle) {
    return null;
  }
  return openGraphSocialPost(url, parsed, {
    authorHandle: `@${handle}`,
    authorName: sanitizeText(
      parsed.title?.match(THREADS_TITLE_REGEX)?.[1],
      128
    ),
    platform: "threads",
    siteName: "Threads",
  });
};
