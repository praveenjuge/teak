import type { LinkCategoryDetail } from "@teak/convex/shared";

export interface ProviderEnrichmentResult {
  imageUrl?: string;
  facts?: LinkCategoryDetail[];
  raw?: Record<string, unknown>;
}

export type RawSelectorEntry = {
  text?: string;
  attributes?: Array<{ name?: string; value?: string }>;
};

export type RawSelectorMap = Map<string, RawSelectorEntry>;

export const normalizeWhitespace = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const getRawText = (
  map: RawSelectorMap,
  selector: string
): string | undefined => {
  return normalizeWhitespace(map.get(selector)?.text);
};

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
    if (!attr?.name) continue;
    if (attr.name.toLowerCase() === needle) {
      return normalizeWhitespace(attr.value);
    }
  }
  return undefined;
};

const extractNumericToken = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = normalizeWhitespace(value);
  if (!trimmed) return undefined;
  const token = trimmed
    .split(" ")
    .find((segment) => /\d/.test(segment.replace(/[,\.]/g, "")));
  return token ?? trimmed;
};

const parseCountToNumber = (value?: string): number | undefined => {
  const token = extractNumericToken(value);
  if (!token) return undefined;
  const lower = token.toLowerCase();
  const multiplier = lower.endsWith("k")
    ? 1_000
    : lower.endsWith("m")
      ? 1_000_000
      : 1;
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
  if (!value) return undefined;
  const numeric = Number.parseFloat(value);
  if (Number.isNaN(numeric)) {
    return normalizeWhitespace(value);
  }
  return numeric.toFixed(2);
};

export const formatDate = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};
