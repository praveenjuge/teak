import type { Doc } from "@teak/convex/_generated/dataModel";
import type { CreatedAtRange } from "@teak/convex/shared";
import type { CardType } from "@teak/convex/shared/constants";

const normalizeSearchTerm = (value: string) => value.toLowerCase().trim();

export const tokenizeSearchQuery = (query: string) =>
  query
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .map(normalizeSearchTerm);

export const buildSearchableText = (card: Doc<"cards">) => {
  const parts: Array<string | undefined> = [
    card.content,
    card.notes,
    card.aiSummary,
    card.aiTranscript,
    card.metadataTitle,
    card.metadataDescription,
    ...(card.tags ?? []),
    ...(card.aiTags ?? []),
  ];

  return parts.filter(Boolean).join(" ").toLowerCase();
};

export interface LocalSearchFilters {
  searchTerms?: string;
  types?: CardType[];
  favoritesOnly?: boolean;
  showTrashOnly?: boolean;
  createdAtRange?: CreatedAtRange;
}

export const filterLocalCards = (
  cards: Doc<"cards">[],
  {
    searchTerms = "",
    types,
    favoritesOnly = false,
    showTrashOnly = false,
    createdAtRange,
  }: LocalSearchFilters
) => {
  const terms = tokenizeSearchQuery(searchTerms);

  return cards
    .filter((card) => {
      if (showTrashOnly) {
        if (card.isDeleted !== true) {
          return false;
        }
      } else if (card.isDeleted) {
        return false;
      }

      if (types && types.length > 0 && !types.includes(card.type)) {
        return false;
      }

      if (favoritesOnly && card.isFavorited !== true) {
        return false;
      }

      if (
        createdAtRange &&
        (card.createdAt < createdAtRange.start ||
          card.createdAt >= createdAtRange.end)
      ) {
        return false;
      }

      if (terms.length === 0) {
        return true;
      }

      const searchableText = buildSearchableText(card);
      return terms.every((term) => searchableText.includes(term));
    })
    .sort((a, b) => b.createdAt - a.createdAt);
};
