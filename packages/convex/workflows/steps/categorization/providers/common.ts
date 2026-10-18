import type { LinkCategoryDetail, LinkPrice } from "@teak/convex/shared";

export interface ProviderEnrichmentResult {
  facts?: LinkCategoryDetail[];
  imageUrl?: string;
  /** A product's price, when the page states one. */
  price?: LinkPrice;
  raw?: Record<string, unknown>;
}

export interface RawSelectorEntry {
  attributes?: Array<{ name?: string; value?: string }>;
  text?: string;
}

export type RawSelectorMap = Map<string, RawSelectorEntry>;

export const normalizeWhitespace = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const getRawText = (
  map: RawSelectorMap,
  selector: string
): string | undefined => normalizeWhitespace(map.get(selector)?.text);

export const getRawAttribute = (
  map: RawSelectorMap,
  selector: string,
  attribute: string
): string | undefined => {
  const entry = map.get(selector);
  if (!entry?.attributes) {
    return undefined;
  }
  const needle = attribute.toLowerCase();
  for (const attr of entry.attributes) {
    if (!attr?.name) {
      continue;
    }
    if (attr.name.toLowerCase() === needle) {
      return normalizeWhitespace(attr.value);
    }
  }
  return undefined;
};

const extractNumericToken = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = normalizeWhitespace(value);
  if (!trimmed) {
    return undefined;
  }
  const token = trimmed
    .split(" ")
    .find((segment) => /\d/.test(segment.replace(/[,.]/g, "")));
  return token ?? trimmed;
};

const parseCountToNumber = (value?: string): number | undefined => {
  const token = extractNumericToken(value);
  if (!token) {
    return undefined;
  }
  const lower = token.toLowerCase();
  let multiplier = 1;
  if (lower.endsWith("k")) {
    multiplier = 1000;
  } else if (lower.endsWith("m")) {
    multiplier = 1_000_000;
  }
  const numericPart = multiplier === 1 ? lower : lower.slice(0, -1);
  const parsed = Number.parseFloat(numericPart.replace(/,/g, ""));
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return Math.round(parsed * multiplier);
};

export const formatCountString = (value?: string): string | undefined => {
  const number = parseCountToNumber(value);
  if (number !== undefined) {
    return number.toLocaleString("en-US");
  }
  return normalizeWhitespace(value);
};

export const formatRating = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }
  const numeric = Number.parseFloat(value);
  if (Number.isNaN(numeric)) {
    return normalizeWhitespace(value);
  }
  return numeric.toFixed(2);
};

const ISO_DAY_REGEX = /^(\d{4}-\d{2}-\d{2})(?:T|$)/;

export const formatDate = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  // An ISO date keeps the day it states ("2009-10-24T23:57:33-07:00" is Oct
  // 24, not the UTC day), and a date-only value keeps its day wherever it
  // runs.
  const trimmed = value.trim();
  const isoDay = ISO_DAY_REGEX.exec(trimmed)?.[1];
  const date = new Date(isoDay ?? trimmed);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  // The whole value must parse, and the stated day must exist (no Feb 30).
  if (
    isoDay &&
    (Number.isNaN(new Date(trimmed).getTime()) ||
      date.toISOString().slice(0, 10) !== isoDay)
  ) {
    return undefined;
  }
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
};
