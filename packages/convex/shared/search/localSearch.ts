import type { Doc } from "../../_generated/dataModel";
import type { CardType } from "../constants";
import { normalizeHueFilters, normalizeVisualStyleFilters } from "../constants";
import { normalizeHexFilters } from "../utils/colorUtils";
import type { CreatedAtRange } from "../utils/timeSearch";
import { normalizeUrlHost } from "../utils/urlHost";
import { SEARCH_LOCAL_SEARCH_CACHE_LIMIT } from "./constants";
import { matchesSearchPhrases, parseSearchQuery } from "./qualifiers";
import { type CardListSort, compareCardsByCreatedAt } from "./sort";
import { tokenizeSearchInput } from "./tokenization";

export interface LocalSearchFilters {
  createdAtRange?: CreatedAtRange;
  favoritesOnly?: boolean;
  hexFilters?: string[];
  hueFilters?: string[];
  searchTerms?: string;
  /** The Archive view: archived cards outside Trash. */
  showArchivedOnly?: boolean;
  showTrashOnly?: boolean;
  /** Order by saved date; newest first when omitted. */
  sort?: CardListSort;
  styleFilters?: string[];
  /** Only cards with this tag (user or AI), matched ignoring case. */
  tag?: string;
  types?: CardType[];
}

export const tokenizeSearchQuery = (query: string) =>
  tokenizeSearchInput(query).map((term) => term.toLowerCase());

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
    showArchivedOnly = false,
    createdAtRange,
    sort = "newest",
    tag,
  }: LocalSearchFilters
) => {
  // Qualifiers filter like the server does; `folder:` names cannot be
  // resolved here, so callers leave folder searches to the server.
  const parsed = parseSearchQuery(searchTerms);
  const terms = tokenizeSearchQuery(parsed.terms.join(" "));
  const tagKeys = [tag?.trim().toLowerCase() ?? "", ...parsed.tags].filter(
    Boolean
  );
  const archivedOnly = showArchivedOnly || parsed.archived;
  const normalizedStyles = normalizeVisualStyleFilters(styleFilters);
  const normalizedHues = normalizeHueFilters(hueFilters);
  const normalizedHexes = normalizeHexFilters(hexFilters).normalized;

  return cards
    .filter((card) => {
      if (showTrashOnly) {
        if (card.isDeleted !== true) {
          return false;
        }
        if (parsed.archived && card.isArchived !== true) {
          return false;
        }
      } else if (
        card.isDeleted ||
        (card.isArchived === true) !== archivedOnly
      ) {
        return false;
      }

      if (types && types.length > 0 && !types.includes(card.type)) {
        return false;
      }
      if (parsed.types.length > 0 && !parsed.types.includes(card.type)) {
        return false;
      }

      if (tagKeys.length > 0) {
        const cardTags = new Set(
          [...(card.tags ?? []), ...(card.aiTags ?? [])].map((cardTag) =>
            cardTag.trim().toLowerCase()
          )
        );
        if (!tagKeys.every((tagKey) => cardTags.has(tagKey))) {
          return false;
        }
      }

      if (parsed.sites.length > 0) {
        const host = normalizeUrlHost(card.url);
        if (!(host && parsed.sites.includes(host))) {
          return false;
        }
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

      if ((favoritesOnly || parsed.favorite) && card.isFavorited !== true) {
        return false;
      }

      if (
        createdAtRange &&
        (card.createdAt < createdAtRange.start ||
          card.createdAt >= createdAtRange.end)
      ) {
        return false;
      }

      if (terms.length === 0 && parsed.phrases.length === 0) {
        return true;
      }

      const searchableText = buildSearchableText(card);
      return (
        terms.every((term) => searchableText.includes(term)) &&
        matchesSearchPhrases(searchableText, parsed.phrases)
      );
    })
    .sort((a, b) => compareCardsByCreatedAt(a, b, sort));
};

export function mergeCardsIntoLocalSearchCache(
  previousCards: Doc<"cards">[],
  incomingCards: Doc<"cards">[],
  cacheLimit = SEARCH_LOCAL_SEARCH_CACHE_LIMIT
) {
  if (incomingCards.length === 0) {
    return previousCards;
  }

  const cacheById = new Map(previousCards.map((card) => [card._id, card]));
  let changed = false;

  for (const card of incomingCards) {
    const existing = cacheById.get(card._id);
    if (!existing || existing.updatedAt !== card.updatedAt) {
      cacheById.set(card._id, card);
      changed = true;
    }
  }

  if (!changed) {
    return previousCards;
  }

  const merged = Array.from(cacheById.values());
  if (merged.length <= cacheLimit) {
    return merged;
  }

  return merged.sort((a, b) => b.createdAt - a.createdAt).slice(0, cacheLimit);
}

/**
 * Drop cached cards that a remote query returned before but no longer does.
 *
 * The local cache only learns about cards the server sends back, so a card
 * deleted (or permanently deleted) on another client would otherwise stay in
 * local search results forever. Callers pass the ids the *same* remote query
 * returned last time; cards that dropped out of it are removed, while cached
 * cards that query never returned (e.g. ones beyond its loaded pages) stay.
 */
export function pruneCardsMissingFromRemote(
  cachedCards: Doc<"cards">[],
  previousRemoteIds: ReadonlySet<string>,
  nextRemoteCards: Doc<"cards">[]
) {
  if (previousRemoteIds.size === 0 || cachedCards.length === 0) {
    return cachedCards;
  }

  const nextRemoteIds = new Set<string>(
    nextRemoteCards.map((card) => card._id)
  );
  const pruned = cachedCards.filter(
    (card) => !previousRemoteIds.has(card._id) || nextRemoteIds.has(card._id)
  );

  return pruned.length === cachedCards.length ? cachedCards : pruned;
}

/**
 * Instant local matches plus what the server found, without duplicates.
 * With `sort`, the combined list is ordered by saved date, so cards the cache
 * picked up in another view never land out of order.
 */
export function mergeLocalAndRemoteSearchResults(
  remoteCards: Doc<"cards">[],
  localSearchResults: Doc<"cards">[],
  hasActiveSearch: boolean,
  sort?: CardListSort
) {
  const ordered = (cards: Doc<"cards">[]) =>
    sort
      ? [...cards].sort((left, right) =>
          compareCardsByCreatedAt(left, right, sort)
        )
      : cards;

  // The previous query's cards stay on screen while a new one loads; keeping
  // them in the chosen order means a sort change takes effect at once.
  if (!hasActiveSearch) {
    return ordered(remoteCards);
  }

  if (remoteCards.length === 0) {
    return ordered(localSearchResults);
  }

  if (localSearchResults.length === 0) {
    return ordered(remoteCards);
  }

  const localIds = new Set(localSearchResults.map((card) => card._id));
  const merged = [...localSearchResults];

  for (const card of remoteCards) {
    if (!localIds.has(card._id)) {
      merged.push(card);
    }
  }

  return ordered(merged);
}
