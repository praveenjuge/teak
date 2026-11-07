import { extractUrlFromContent } from "./linkDetection";
import { urlKey } from "./urlKey";

/**
 * The card's text is only its link: empty, the URL itself, or another form
 * of the same page (`urlKey`: `www.`, a trailing slash, a fragment, tracking
 * parameters). Saving such a card makes a link card, and classifying it
 * keeps it one, whatever its URL ends in.
 */
export const isBareLinkContent = (content: string, url: string): boolean => {
  const trimmed = content.trim();
  if (!trimmed || trimmed === url) {
    return true;
  }
  const extracted = extractUrlFromContent(trimmed);
  if (!extracted.url || extracted.cleanedContent !== extracted.url) {
    return false;
  }
  return (
    extracted.url === url ||
    (urlKey(extracted.url) ?? extracted.url) === (urlKey(url) ?? url)
  );
};
