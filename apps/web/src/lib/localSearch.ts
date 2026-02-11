import type { Doc } from "@teak/convex/_generated/dataModel";
import { type CreatedAtRange, normalizeHexFilters } from "@teak/convex/shared";
import {
  type CardType,
  normalizeHueFilters,
  normalizeVisualStyleFilters,
} from "@teak/convex/shared/constants";

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
  styleFilters?: string[];
  hueFilters?: string[];
  hexFilters?: string[];
  favoritesOnly?: boolean;
  showTrashOnly?: boolean;
  createdAtRange?: CreatedAtRange;
}

const matchesVisualFilters = (
  card: Doc<"cards">,
  filters: {
    styleFilters: string[];
    hueFilters: string[];
    hexFilters: string[];
  }
) => {
  if (filters.styleFilters.length > 0) {
    if (card.type !== "image") {
      return false;
    }

    const styleSet = new Set(card.visualStyles ?? []);
    if (!filters.styleFilters.some((style) => styleSet.has(style))) {
      return false;
    }
  }

  if (filters.hueFilters.length > 0) {
    if (!(card.type === "image" || card.type === "palette")) {
      return false;
    }

    const hueSet = new Set(card.colorHues ?? []);
    if (!filters.hueFilters.some((hue) => hueSet.has(hue))) {
      return false;
    }
  }

  if (filters.hexFilters.length > 0) {
    if (!(card.type === "image" || card.type === "palette")) {
      return false;
    }

    const hexSet = new Set(card.colorHexes ?? []);
    if (!filters.hexFilters.some((hex) => hexSet.has(hex))) {
      return false;
    }
  }

  return true;
};

export const filterLocalCards = (
  cards: Doc<"cards">[],
  {
    searchTerms = "",
    types,
    styleFilters,
    hueFilters,
    hexFilters,
    favoritesOnly = false,
    showTrashOnly = false,
    createdAtRange,
  }: LocalSearchFilters
) => {
  const terms = tokenizeSearchQuery(searchTerms);
  const normalizedStyles = normalizeVisualStyleFilters(styleFilters);
  const normalizedHues = normalizeHueFilters(hueFilters);
  const normalizedHexes = normalizeHexFilters(hexFilters).normalized;

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

      if (
        !matchesVisualFilters(card, {
          styleFilters: normalizedStyles,
          hueFilters: normalizedHues,
          hexFilters: normalizedHexes,
        })
      ) {
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
