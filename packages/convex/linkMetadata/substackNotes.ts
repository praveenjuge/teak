import { sanitizeText } from "./parsing";
import type { ParsedLinkPreview, SocialPostMetadata } from "./socialPost";
import { openGraphSocialPost } from "./socialPostHelpers";

const SUBSTACK_HOST_REGEX = /(^|\.)substack\.com$/i;
const SUBSTACK_NOTE_PATH_REGEX = /^\/(?:@([^/]+)\/)?note\/[^/]+\/?$/i;
// og:title reads "Ada Lovelace (@ada) on Substack" or "Ada Lovelace on Substack".
const SUBSTACK_TITLE_REGEX = /^(.+?)\s*(?:\(@[^)]+\)\s*)?on Substack/i;

export interface SubstackNoteRef {
  handle: string | undefined;
}

/** `substack.com/@<user>/note/<id>` (or `/note/<id>`). */
export const parseSubstackNoteUrl = (url: string): SubstackNoteRef | null => {
  try {
    const parsed = new URL(url);
    if (!SUBSTACK_HOST_REGEX.test(parsed.hostname)) {
      return null;
    }
    const match = parsed.pathname.match(SUBSTACK_NOTE_PATH_REGEX);
    return match ? { handle: match[1] } : null;
  } catch {
    return null;
  }
};

export const isSubstackNoteUrl = (url: string): boolean =>
  parseSubstackNoteUrl(url) !== null;

/**
 * A Substack note from its Open Graph tags. Substack has no documented
 * unauthenticated JSON for notes, so the page scrape is the source.
 */
export const mapSubstackNoteOpenGraph = (
  url: string,
  parsed: ParsedLinkPreview
): SocialPostMetadata | null => {
  const ref = parseSubstackNoteUrl(url);
  if (!ref) {
    return null;
  }
  return openGraphSocialPost(url, parsed, {
    authorHandle: ref.handle ? `@${ref.handle}` : undefined,
    authorName: sanitizeText(
      parsed.title?.match(SUBSTACK_TITLE_REGEX)?.[1],
      128
    ),
    platform: "substack_notes",
    siteName: "Substack",
  });
};
