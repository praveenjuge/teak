import type { LinkCategory } from "@teak/convex/shared";
import { enrichAmazon } from "./amazon";
import type { ProviderEnrichmentResult, RawSelectorMap } from "./common";
import { enrichDribbble } from "./dribbble";
import { enrichGithub } from "./github";
import { enrichGoodreads } from "./goodreads";
import { enrichImdb } from "./imdb";

type ProviderHandler = {
  categories: LinkCategory[];
  enrich: (rawMap: RawSelectorMap) => ProviderEnrichmentResult | null;
};

const handlers: Record<string, ProviderHandler> = {
  github: {
    categories: ["software"],
    enrich: enrichGithub,
  },
  goodreads: {
    categories: ["book"],
    enrich: enrichGoodreads,
  },
  amazon: {
    categories: ["product", "book"],
    enrich: enrichAmazon,
  },
  imdb: {
    categories: ["movie", "tv"],
    enrich: enrichImdb,
  },
  dribbble: {
    categories: ["design_portfolio"],
    enrich: enrichDribbble,
  },
};

export const enrichProvider = (
  provider: string | undefined,
  category: LinkCategory,
  rawMap: RawSelectorMap,
  allowMismatchedCategory = false
): ProviderEnrichmentResult | null => {
  if (!provider) {
    return null;
  }

  const handler = handlers[provider];
  if (!handler) {
    return null;
  }

  if (!(handler.categories.includes(category) || allowMismatchedCategory)) {
    return null;
  }

  return handler.enrich(rawMap);
};
