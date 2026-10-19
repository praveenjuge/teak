import { sanitizeText } from "./parsing";
import type { ParsedLinkPreview, SocialPostMetadata } from "./socialPost";
import { openGraphSocialPost } from "./socialPostHelpers";

const LINKEDIN_HOST_REGEX = /(^|\.)linkedin\.com$/i;
const LINKEDIN_POST_PATH_REGEX = /^\/(?:posts\/[^/]+|feed\/update\/[^/]+)/i;
// og:title reads "Ada Lovelace on LinkedIn: <the post>" or
// "<the post> | Ada Lovelace | N comments".
const LINKEDIN_TITLE_AUTHOR_REGEX = /^(.+?) on LinkedIn\b/i;
const LINKEDIN_TITLE_PIPE_REGEX = /\|\s*([^|]+?)\s*\|\s*\d+\s+comments?/i;

export const isLinkedInPostUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return (
      LINKEDIN_HOST_REGEX.test(parsed.hostname) &&
      LINKEDIN_POST_PATH_REGEX.test(parsed.pathname)
    );
  } catch {
    return false;
  }
};

const linkedInAuthor = (parsed: ParsedLinkPreview): string | undefined =>
  sanitizeText(
    parsed.title?.match(LINKEDIN_TITLE_AUTHOR_REGEX)?.[1] ??
      parsed.title?.match(LINKEDIN_TITLE_PIPE_REGEX)?.[1] ??
      parsed.author,
    128
  );

// LinkedIn has no public API for posts.
export const mapLinkedInOpenGraph = (
  url: string,
  parsed: ParsedLinkPreview
): SocialPostMetadata | null => {
  if (!isLinkedInPostUrl(url)) {
    return null;
  }
  return openGraphSocialPost(url, parsed, {
    authorName: linkedInAuthor(parsed),
    platform: "linkedin",
    siteName: "LinkedIn",
    textFromTitle: true,
  });
};
