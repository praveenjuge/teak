export interface LinkBylineSource {
  author?: string;
  hostname?: string | null;
  publishedAt?: string;
  publisher?: string;
}

const MAX_NAME_LENGTH = 80;
const EARLIEST_PUBLISHED_YEAR = 1990;
// Pages sometimes carry tomorrow's date in another time zone.
const FUTURE_TOLERANCE_MS = 36 * 60 * 60 * 1000;

const looksLikeUrl = (value: string) =>
  /^(?:https?:)?\/\//iu.test(value) || /^www\./iu.test(value);

const cleanName = (value?: string): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const name = value
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^by\s+/iu, "")
    .trim();
  if (!name || looksLikeUrl(name)) {
    return null;
  }
  if (name.length <= MAX_NAME_LENGTH) {
    return name;
  }
  return `${name.slice(0, MAX_NAME_LENGTH - 1).trimEnd()}…`;
};

const comparable = (value: string) =>
  value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

const namesHost = (key: string, hostname?: string | null) =>
  Boolean(hostname) &&
  (hostname as string)
    .toLowerCase()
    .split(".")
    .some((label) => label !== "www" && comparable(label) === key);

/**
 * A page's publish date as "Mar 5, 2024", or null when the page's value is
 * missing, unparseable, implausibly old or in the future. Date-only values
 * are calendar dates, so they're formatted in UTC to avoid shifting a day.
 */
export function formatPublishedDate(
  publishedAt?: string,
  now = Date.now()
): string | null {
  if (typeof publishedAt !== "string" || !publishedAt.trim()) {
    return null;
  }
  const timestamp = Date.parse(publishedAt.trim());
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() < EARLIEST_PUBLISHED_YEAR ||
    timestamp > now + FUTURE_TOLERANCE_MS
  ) {
    return null;
  }
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  });
}

/**
 * "By Jane Doe · The Paper · Mar 5, 2024" for a link card, skipping a
 * publisher that only repeats the author or the site's own hostname. Returns
 * null when the page named nothing worth showing.
 */
export function formatLinkByline(
  source: LinkBylineSource,
  now = Date.now()
): string | null {
  const author = cleanName(source.author);
  let publisher = cleanName(source.publisher);
  if (publisher) {
    const key = comparable(publisher);
    if (
      !key ||
      namesHost(key, source.hostname) ||
      (author !== null && key === comparable(author))
    ) {
      publisher = null;
    }
  }
  const parts = [
    author ? `By ${author}` : null,
    publisher,
    formatPublishedDate(source.publishedAt, now),
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(" · ") : null;
}
