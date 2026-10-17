import { isSafeExternalUrl } from "./utils/safeUrl";

/** The longest `sourceUrl` a card keeps. */
export const MAX_SOURCE_URL_LENGTH = 2048;
/** `sourceTitle` is trimmed and cut to this many characters. */
export const MAX_SOURCE_TITLE_LENGTH = 300;

export interface CardSource {
  sourceTitle?: string;
  sourceUrl?: string;
}

/**
 * Explains why a card's source can't be saved, or returns null. The URL must
 * be http or https and at most 2,048 characters; a title needs a URL.
 */
export const explainInvalidCardSource = ({
  sourceTitle,
  sourceUrl,
}: CardSource): string | null => {
  const url = sourceUrl?.trim();
  if (sourceUrl !== undefined && !url) {
    return "`sourceUrl` cannot be blank";
  }
  if (url !== undefined && url.length > MAX_SOURCE_URL_LENGTH) {
    return `\`sourceUrl\` must be at most ${MAX_SOURCE_URL_LENGTH} characters`;
  }
  if (url !== undefined && !isSafeExternalUrl(url)) {
    return "`sourceUrl` must use the http or https scheme";
  }
  if (sourceTitle?.trim() && url === undefined) {
    return "`sourceTitle` needs a `sourceUrl`";
  }
  return null;
};

/**
 * The fields a valid source stores: the trimmed URL, and the trimmed title
 * cut to 300 characters (left out when blank).
 */
export const normalizeCardSource = ({
  sourceTitle,
  sourceUrl,
}: CardSource): CardSource => {
  const url = sourceUrl?.trim();
  if (!url) {
    return {};
  }
  // Cut by code point, so an emoji at the limit isn't split in half.
  const title = [...(sourceTitle?.trim() ?? "")]
    .slice(0, MAX_SOURCE_TITLE_LENGTH)
    .join("")
    .trim();
  return title ? { sourceTitle: title, sourceUrl: url } : { sourceUrl: url };
};
