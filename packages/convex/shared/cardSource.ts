import { truncateCodePoints } from "./utils/codePoints";
import { isSafeExternalUrl } from "./utils/safeUrl";

export const MAX_SOURCE_URL_LENGTH = 2048;
export const MAX_SOURCE_TITLE_LENGTH = 300;

export interface CardSource {
  sourceTitle?: string;
  sourceUrl?: string;
}

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

export const normalizeCardSource = ({
  sourceTitle,
  sourceUrl,
}: CardSource): CardSource => {
  const url = sourceUrl?.trim();
  if (!(url && isSafeExternalUrl(url))) {
    return {};
  }
  const title = truncateCodePoints(
    sourceTitle?.trim() ?? "",
    MAX_SOURCE_TITLE_LENGTH
  ).trim();
  return title ? { sourceTitle: title, sourceUrl: url } : { sourceUrl: url };
};
