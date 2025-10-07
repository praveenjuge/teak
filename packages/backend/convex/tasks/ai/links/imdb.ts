import type { LinkCategoryDetail } from "@teak/shared";
import type {
  ProviderEnrichmentResult,
  RawSelectorMap,
} from "./common";
import {
  formatCountString,
  formatDate,
  formatRating,
  getRawAttribute,
  getRawText,
} from "./common";

export const enrichImdb = (
  rawMap: RawSelectorMap
): ProviderEnrichmentResult | null => {
  const rating = formatRating(
    getRawAttribute(rawMap, "meta[name='imdb:rating']", "content") ||
    getRawText(
      rawMap,
      "span[data-testid='hero-rating-bar__aggregate-rating__score']"
    )
  );
  const votes = formatCountString(
    getRawAttribute(rawMap, "meta[name='imdb:votes']", "content")
  );
  const runtime = getRawText(
    rawMap,
    "span[data-testid='title-techspec_runtime'] span"
  );
  const releaseDateRaw = getRawAttribute(
    rawMap,
    "meta[property='video:release_date']",
    "content"
  );
  const releaseDate = formatDate(releaseDateRaw ?? "");

  const facts: LinkCategoryDetail[] = [];
  if (rating) {
    facts.push({ label: "IMDb rating", value: `${rating} / 10` });
  }
  if (votes) {
    facts.push({ label: "Votes", value: votes });
  }
  if (runtime) {
    facts.push({ label: "Runtime", value: runtime });
  }
  if (releaseDate) {
    facts.push({ label: "Released", value: releaseDate });
  }

  if (facts.length === 0) {
    return null;
  }

  return {
    facts,
    raw: {
      rating: rating ?? null,
      votes: votes ?? null,
      runtime: runtime ?? null,
      releaseDate: releaseDateRaw ?? null,
    },
  };
};
