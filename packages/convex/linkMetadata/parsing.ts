import {
  AUTHOR_SOURCES,
  CANONICAL_SOURCES,
  DESCRIPTION_SOURCES,
  FAVICON_SOURCES,
  FINAL_URL_SOURCES,
  IMAGE_SOURCES,
  PUBLISHED_TIME_SOURCES,
  PUBLISHER_SOURCES,
  SITE_NAME_SOURCES,
  TITLE_SOURCES,
} from "./selectors";
import type {
  LinkPreviewMetadata,
  ScrapeResultItem,
  ScrapeSelectorResult,
  SelectorSource,
} from "./types";

export const toSelectorMap = (
  results?: ScrapeSelectorResult[]
): Map<string, ScrapeResultItem[]> => {
  const map = new Map<string, ScrapeResultItem[]>();
  if (!results) {
    return map;
  }
  for (const entry of results) {
    map.set(entry.selector, entry.results ?? []);
  }
  return map;
};

export const findAttributeValue = (
  item: ScrapeResultItem | undefined,
  attribute: string
): string | undefined => {
  if (!item?.attributes) {
    return undefined;
  }
  const needle = attribute.toLowerCase();
  const match = item.attributes.find(
    (attr) => attr.name?.toLowerCase() === needle
  );
  return match?.value?.trim() || undefined;
};

export const getSelectorValue = (
  map: Map<string, ScrapeResultItem[]>,
  source: SelectorSource
): string | undefined => {
  const candidates = map.get(source.selector) ?? [];
  const primary =
    candidates.find((item) => {
      if (source.attribute === "text") {
        const value = item.text?.trim() || item.html?.trim();
        return Boolean(value);
      }
      const attrValue = findAttributeValue(item, source.attribute);
      return Boolean(attrValue);
    }) ?? candidates[0];

  if (!primary) {
    return undefined;
  }

  if (source.attribute === "text") {
    return primary.text?.trim() || primary.html?.trim() || undefined;
  }

  return findAttributeValue(primary, source.attribute);
};

export const firstFromSources = (
  map: Map<string, ScrapeResultItem[]>,
  sources: SelectorSource[]
): string | undefined => {
  for (const source of sources) {
    const value = getSelectorValue(map, source);
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

export const sanitizeText = (
  value: string | undefined,
  maxLength: number
): string | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length > maxLength) {
    return normalized.slice(0, maxLength);
  }
  return normalized;
};

export const sanitizeUrl = (
  baseUrl: string,
  value: string | undefined,
  { allowData }: { allowData?: boolean } = {}
): string | undefined => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^data:/i.test(trimmed)) {
    return allowData ? trimmed : undefined;
  }

  if (/^(javascript:|mailto:)/i.test(trimmed)) {
    return undefined;
  }

  try {
    const resolved = new URL(trimmed, baseUrl);
    if (!/^https?:/i.test(resolved.protocol)) {
      return undefined;
    }
    return resolved.toString();
  } catch {
    return undefined;
  }
};

export const sanitizeImageUrl = (
  baseUrl: string,
  value: string | undefined
): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (/^data:/i.test(trimmed)) {
    return trimmed;
  }
  return sanitizeUrl(baseUrl, trimmed, { allowData: true });
};

export const buildDebugRaw = (
  results?: ScrapeSelectorResult[]
): ScrapeSelectorResult[] | undefined => {
  if (!results) {
    return undefined;
  }
  return results.map((entry) => ({
    selector: entry.selector,
    results: (entry.results ?? []).slice(0, 1).map((item) => ({
      text: item.text,
      attributes: item.attributes,
    })),
  }));
};

export const parseLinkPreview = (
  normalizedUrl: string,
  results?: ScrapeSelectorResult[]
) => {
  const selectorMap = toSelectorMap(results);

  const title = sanitizeText(firstFromSources(selectorMap, TITLE_SOURCES), 512);
  const description = sanitizeText(
    firstFromSources(selectorMap, DESCRIPTION_SOURCES),
    2048
  );
  const imageUrl = sanitizeImageUrl(
    normalizedUrl,
    firstFromSources(selectorMap, IMAGE_SOURCES)
  );
  const faviconUrl = sanitizeUrl(
    normalizedUrl,
    firstFromSources(selectorMap, FAVICON_SOURCES)
  );
  const siteName = sanitizeText(
    firstFromSources(selectorMap, SITE_NAME_SOURCES),
    256
  );
  const author = sanitizeText(
    firstFromSources(selectorMap, AUTHOR_SOURCES),
    256
  );
  const publisher = sanitizeText(
    firstFromSources(selectorMap, PUBLISHER_SOURCES),
    256
  );
  const publishedAtRaw = firstFromSources(selectorMap, PUBLISHED_TIME_SOURCES);
  const publishedAt = publishedAtRaw
    ? publishedAtRaw.trim().slice(0, 128)
    : undefined;
  const canonicalUrl = sanitizeUrl(
    normalizedUrl,
    firstFromSources(selectorMap, CANONICAL_SOURCES)
  );
  const finalUrlCandidate = sanitizeUrl(
    normalizedUrl,
    firstFromSources(selectorMap, FINAL_URL_SOURCES)
  );

  return {
    title,
    description,
    imageUrl,
    faviconUrl,
    siteName,
    author,
    publisher,
    publishedAt,
    canonicalUrl,
    finalUrl: finalUrlCandidate ?? canonicalUrl ?? normalizedUrl,
    raw: buildDebugRaw(results),
  };
};

export const buildSuccessPreview = (
  url: string,
  parsed: ReturnType<typeof parseLinkPreview>
): LinkPreviewMetadata => ({
  source: "kernel_playwright",
  status: "success",
  fetchedAt: Date.now(),
  url,
  ...parsed,
});

export const buildErrorPreview = (
  url: string,
  error: {
    type: string;
    message?: string;
    details?: any;
  },
  extras?: Pick<
    LinkPreviewMetadata,
    "screenshotStorageId" | "screenshotUpdatedAt"
  >
): LinkPreviewMetadata => ({
  source: "kernel_playwright",
  status: "error",
  fetchedAt: Date.now(),
  url,
  finalUrl: url,
  ...(extras?.screenshotStorageId
    ? {
        screenshotStorageId: extras.screenshotStorageId,
        screenshotUpdatedAt: extras.screenshotUpdatedAt,
      }
    : {}),
  error,
});
