import type { LinkCategoryDetail } from "@teak/convex/shared";
import type { ProviderEnrichmentResult, RawSelectorMap } from "./common";
import { getRawAttribute, getRawText, normalizeWhitespace } from "./common";

export const enrichAmazon = (
  rawMap: RawSelectorMap
): ProviderEnrichmentResult | null => {
  const priceText =
    getRawText(rawMap, "#priceblock_ourprice") ||
    getRawText(rawMap, "#priceblock_dealprice") ||
    getRawText(rawMap, ".a-price .a-offscreen") ||
    normalizeWhitespace(
      getRawAttribute(rawMap, "meta[name='price']", "content") ||
        getRawAttribute(rawMap, "meta[property='og:price:amount']", "content")
    );
  const currency = getRawAttribute(
    rawMap,
    "meta[property='og:price:currency']",
    "content"
  );

  if (!(priceText || currency)) {
    return null;
  }

  const priceLabel = currency
    ? `${priceText ?? ""} ${currency}`.trim()
    : priceText;

  const facts: LinkCategoryDetail[] | undefined = priceLabel
    ? [{ label: "Price", value: priceLabel }]
    : undefined;

  return {
    facts,
    raw: {
      price: priceText ?? null,
      currency: currency ?? null,
    },
  };
};
