import type { LinkCategoryDetail } from "@teak/convex/shared";
import type { ProviderEnrichmentResult, RawSelectorMap } from "./common";
import {
  formatCountString,
  getRawAttribute,
  getRawText,
  normalizeWhitespace,
} from "./common";

const LIKES_SELECTORS = [
  "a[href$='/likes']",
  "[data-testid='shot-likes']",
  "[data-testid='shot-likes-count']",
  ".shot-stats [data-label='Likes']",
];

const VIEWS_SELECTORS = [
  "a[href$='/views']",
  "[data-testid='shot-views']",
  "[data-testid='shot-views-count']",
  ".shot-stats [data-label='Views']",
];

const COMMENTS_SELECTORS = [
  "a[href$='/comments']",
  "[data-testid='shot-comments']",
  "[data-testid='shot-comments-count']",
  ".shot-stats [data-label='Comments']",
];

const DESIGNER_SELECTORS = [
  "meta[name='twitter:creator']",
  "a[rel='author']",
  ".shot-byline a",
];

const KEYWORDS_SELECTORS = [
  "meta[name='keywords']",
  "meta[name='parsely-tags']",
  "meta[property='article:tag']",
];

type StatResult = {
  raw?: string;
  formatted?: string;
};

type DribbbleStatKey = "likes" | "views" | "comments";

const mapLabelToStat = (label: string): DribbbleStatKey | undefined => {
  const normalized = label.toLowerCase();
  if (normalized.includes("like")) {
    return "likes";
  }
  if (normalized.includes("view")) {
    return "views";
  }
  if (normalized.includes("comment")) {
    return "comments";
  }
  return undefined;
};

const extractTwitterStats = (
  rawMap: RawSelectorMap
): Partial<Record<DribbbleStatKey, string>> => {
  const stats: Partial<Record<DribbbleStatKey, string>> = {};
  for (let index = 1; index <= 4; index += 1) {
    const labelRaw = getRawAttribute(
      rawMap,
      `meta[name='twitter:label${index}']`,
      "content"
    );
    const valueRaw = getRawAttribute(
      rawMap,
      `meta[name='twitter:data${index}']`,
      "content"
    );
    const label = normalizeWhitespace(labelRaw);
    const value = normalizeWhitespace(valueRaw);
    if (!(label && value)) {
      continue;
    }
    const key = mapLabelToStat(label);
    if (!key || stats[key]) {
      continue;
    }
    stats[key] = value;
  }
  return stats;
};

const normalizeStatValue = (value?: string): StatResult | undefined => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return undefined;
  }
  return {
    raw: value,
    formatted: formatCountString(normalized) ?? normalized,
  };
};

const extractStat = (
  rawMap: RawSelectorMap,
  selectors: string[],
  seed?: string
): StatResult => {
  if (seed) {
    const seeded = normalizeStatValue(seed);
    if (seeded) return seeded;
  }
  for (const selector of selectors) {
    const value = selector.startsWith("meta[")
      ? getRawAttribute(rawMap, selector, "content")
      : getRawText(rawMap, selector);
    const normalized = normalizeStatValue(value);
    if (normalized) return normalized;
  }
  return {};
};

const getFirstAttribute = (
  rawMap: RawSelectorMap,
  selectors: string[],
  attribute: string
): string | undefined => {
  for (const selector of selectors) {
    const value = getRawAttribute(rawMap, selector, attribute);
    if (value) return value;
  }
  return undefined;
};

const sanitizeDesignerName = (value?: string): string | undefined => {
  let normalized = normalizeWhitespace(value);
  if (!normalized) return undefined;

  normalized = normalized.replace(/^@/, "").trim();
  normalized = normalized.replace(/\s+on\s+dribbble$/i, "").trim();
  return normalized || undefined;
};

const extractDesigner = (
  rawMap: RawSelectorMap
): {
  display?: string;
  raw?: string;
} => {
  const metaAuthor =
    getRawAttribute(rawMap, "meta[name='author']", "content") ||
    getRawAttribute(rawMap, "meta[property='article:author']", "content");
  const candidates = [
    metaAuthor,
    ...DESIGNER_SELECTORS.map((selector) =>
      selector.startsWith("meta[")
        ? getRawAttribute(rawMap, selector, "content")
        : getRawText(rawMap, selector)
    ),
  ].filter((value): value is string => Boolean(value));

  const title =
    getRawAttribute(rawMap, "meta[property='og:title']", "content") ||
    getRawText(rawMap, "head > title");
  if (title) {
    const lowered = title.toLowerCase();
    const byIndex = lowered.lastIndexOf(" by ");
    if (byIndex !== -1) {
      const candidate = normalizeWhitespace(
        title
          .slice(byIndex + 4)
          .replace(/\|\s*dribbble$/i, "")
          .replace(/\son\s+dribbble$/i, "")
          .trim()
      );
      if (candidate) {
        candidates.unshift(candidate);
      }
    }
  }

  for (const candidate of candidates) {
    const display = sanitizeDesignerName(candidate);
    if (display) return { display, raw: candidate };
  }
  return {};
};

const extractKeywords = (rawMap: RawSelectorMap): string[] | undefined => {
  const keywordString =
    getFirstAttribute(rawMap, KEYWORDS_SELECTORS, "content") ||
    getRawText(rawMap, "a[rel='tag']");
  if (!keywordString) {
    return undefined;
  }
  const values = keywordString
    .split(/[,|]/)
    .map((item) => normalizeWhitespace(item))
    .filter((item): item is string => Boolean(item));
  if (values.length === 0) {
    return undefined;
  }
  const unique: string[] = [];
  for (const value of values) {
    if (!unique.includes(value)) {
      unique.push(value);
    }
    if (unique.length === 5) {
      break;
    }
  }
  return unique;
};

const extractImage = (rawMap: RawSelectorMap): string | undefined => {
  return (
    getRawAttribute(
      rawMap,
      "meta[property='og:image:secure_url']",
      "content"
    ) ||
    getRawAttribute(rawMap, "meta[property='og:image']", "content") ||
    getRawAttribute(rawMap, "meta[name='og:image']", "content") ||
    getRawAttribute(rawMap, "meta[name='twitter:image']", "content") ||
    getRawAttribute(rawMap, "meta[property='twitter:image']", "content")
  );
};

const buildRawPayload = (
  data: Record<string, unknown>
): Record<string, unknown> | undefined => {
  const entries = Object.entries(data).filter(
    ([, value]) => value !== undefined && value !== null
  );
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(entries);
};

export const enrichDribbble = (
  rawMap: RawSelectorMap
): ProviderEnrichmentResult | null => {
  const designer = extractDesigner(rawMap);
  const twitterStats = extractTwitterStats(rawMap);
  const likes = extractStat(rawMap, LIKES_SELECTORS, twitterStats.likes);
  const views = extractStat(rawMap, VIEWS_SELECTORS, twitterStats.views);
  const comments = extractStat(
    rawMap,
    COMMENTS_SELECTORS,
    twitterStats.comments
  );
  const keywords = extractKeywords(rawMap);
  const title =
    getRawAttribute(rawMap, "meta[property='og:title']", "content") ||
    getRawText(rawMap, "head > title");
  const description =
    getRawAttribute(rawMap, "meta[property='og:description']", "content") ||
    getRawAttribute(rawMap, "meta[name='description']", "content");
  const imageUrl = extractImage(rawMap);

  const facts: LinkCategoryDetail[] = [];
  if (designer.display) {
    facts.push({ label: "Designer", value: designer.display });
  }
  if (likes.formatted) {
    facts.push({ label: "Likes", value: likes.formatted });
  }
  if (views.formatted) {
    facts.push({ label: "Views", value: views.formatted });
  }
  if (comments.formatted) {
    facts.push({ label: "Comments", value: comments.formatted });
  }
  if (keywords?.length) {
    const tagPreview = keywords.slice(0, 3).join(", ");
    facts.push({
      label: keywords.length > 1 ? "Tags" : "Tag",
      value: tagPreview,
    });
  }

  const statsRaw = buildRawPayload({
    likes: likes.raw ?? likes.formatted,
    views: views.raw ?? views.formatted,
    comments: comments.raw ?? comments.formatted,
  });

  const raw = buildRawPayload({
    title,
    description,
    designer: designer.raw ?? designer.display,
    stats: statsRaw,
    keywords,
  });

  if (!imageUrl && facts.length === 0 && !raw) {
    return null;
  }

  return {
    imageUrl,
    facts: facts.length > 0 ? facts : undefined,
    raw,
  };
};
