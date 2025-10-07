import type { LinkCategoryDetail } from "@teak/shared";
import type {
  ProviderEnrichmentResult,
  RawSelectorMap,
} from "./common";
import {
  formatCountString,
  formatRating,
  getRawAttribute,
} from "./common";

export const enrichGoodreads = (
  rawMap: RawSelectorMap
): ProviderEnrichmentResult | null => {
  const avg = formatRating(
    getRawAttribute(rawMap, "meta[property='books:rating:average']", "content")
  );
  const count = formatCountString(
    getRawAttribute(rawMap, "meta[property='books:rating:count']", "content")
  );
  const isbn = getRawAttribute(
    rawMap,
    "meta[property='books:isbn']",
    "content"
  );

  const facts: LinkCategoryDetail[] = [];
  if (avg) {
    facts.push({ label: "Average rating", value: `${avg} / 5` });
  }
  if (count) {
    facts.push({ label: "Ratings", value: count });
  }
  if (isbn) {
    facts.push({ label: "ISBN", value: isbn });
  }

  if (facts.length === 0) {
    return null;
  }

  return {
    facts,
    raw: {
      ratingAverage: avg ?? null,
      ratingCount: count ?? null,
      isbn: isbn ?? null,
    },
  };
};
