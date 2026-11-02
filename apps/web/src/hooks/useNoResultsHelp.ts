import { api } from "@teak/convex";
import { useIntlLocale, useTranslations, useUiLocale } from "@teak/i18n/react";
import { useCallback, useMemo } from "react";
import type { RemovableSearchChip } from "@/components/search/NoSearchResults";
import { describeKeywordChip } from "@/components/search/searchSuggestions";
import { useQuery } from "@/lib/convexQueryHooks";
import {
  buildSearchVocabulary,
  suggestSearchSpelling,
} from "../lib/didYouMean";
import type { TagSummaryItem } from "../lib/tags";
import { timeFilterLabel } from "../lib/timeFilterLabel";
import type { UseCardsSearchControllerResult } from "./useCardsSearchController";

/** A word that is search syntax rather than text: `-word`, `#tag`, `key:value`, `(`, `OR`. */
const SEARCH_SYNTAX = /^[-#(]|^[a-z]+:|^OR$/i;

/**
 * Whether anything but words narrows the search: a tag, type, date, color,
 * style or qualifier, or the favorites filter (which a new note wouldn't
 * pass, so the search would still find nothing).
 */
export const searchHasFilters = (search: {
  filterTags: readonly unknown[];
  hexFilters: readonly unknown[];
  hueFilters: readonly unknown[];
  qualifierChips?: readonly unknown[];
  showFavoritesOnly: boolean;
  styleFilters: readonly unknown[];
  tagFilter?: unknown;
  timeFilter?: unknown;
}): boolean =>
  Boolean(search.tagFilter || search.timeFilter || search.showFavoritesOnly) ||
  search.filterTags.length > 0 ||
  search.hexFilters.length > 0 ||
  search.hueFilters.length > 0 ||
  search.styleFilters.length > 0 ||
  (search.qualifierChips?.length ?? 0) > 0;

/**
 * The text a search that found nothing would save as a note: its words,
 * when the search is only words (no filters, no search syntax).
 */
export const searchNoteText = (
  searchTerms: string,
  hasFilters: boolean
): string | null => {
  const words = searchTerms.trim();
  if (
    hasFilters ||
    !words ||
    words.split(/\s+/).some((word) => SEARCH_SYNTAX.test(word))
  ) {
    return null;
  }
  return words;
};

/**
 * What the empty state of a search offers: each of its filters as a chip to
 * drop, a "Did you mean" built from the person's own tags, folder names
 * and card titles, and the words themselves to save as a note when the
 * search is nothing but words. The tags are read only once a search has
 * found nothing.
 */
export function useNoResultsHelp({
  controller,
  foundNothing,
  folderNames,
}: {
  controller: UseCardsSearchControllerResult;
  folderNames: readonly string[] | undefined;
  foundNothing: boolean;
}): {
  chips: RemovableSearchChip[];
  noteText: string | null;
  suggestion: string | null;
  applySuggestion: (search: string) => void;
} {
  const tTypes = useTranslations("cards.types");
  const tDates = useTranslations("search.dates");
  const intlLocale = useIntlLocale();
  const uiLocale = useUiLocale();
  const {
    applyUrlState,
    cachedCards,
    filterTags,
    hexFilters,
    hueFilters,
    searchBarProps,
    showFavoritesOnly,
    styleFilters,
    searchTerms,
    tagFilter,
    timeFilter,
    urlState,
  } = controller;
  const wantsSuggestion = foundNothing && searchTerms !== "";
  const tagSummary = useQuery(
    api.tags.listTagSummary,
    wantsSuggestion ? {} : "skip"
  );
  const suggestion = useMemo(() => {
    if (!wantsSuggestion) {
      return null;
    }
    const vocabulary = buildSearchVocabulary([
      ...(tagSummary?.items ?? []).map((item: TagSummaryItem) => item.name),
      ...(folderNames ?? []),
      ...cachedCards.map((card) => card.metadataTitle ?? card.content),
    ]);
    return suggestSearchSpelling(searchTerms, vocabulary);
  }, [cachedCards, folderNames, searchTerms, tagSummary, wantsSuggestion]);
  const applySuggestion = useCallback(
    (search: string) => applyUrlState({ ...urlState, q: search }),
    [applyUrlState, urlState]
  );

  const chips: RemovableSearchChip[] = [];
  if (tagFilter) {
    chips.push({
      key: "tag-filter",
      label: `#${tagFilter}`,
      onRemove: () => searchBarProps.onRemoveTagFilter?.(),
    });
  }
  for (const chip of searchBarProps.qualifierChips ?? []) {
    chips.push({
      key: `qualifier-${chip}`,
      label: chip,
      onRemove: () => searchBarProps.onRemoveQualifier?.(chip),
    });
  }
  for (const keyword of searchBarProps.keywordTags) {
    const { excluded, label } = describeKeywordChip(keyword);
    chips.push({
      key: `keyword-${keyword}`,
      label: excluded ? `−${label}` : label,
      onRemove: () => searchBarProps.onRemoveKeyword(keyword),
    });
  }
  if (timeFilter) {
    chips.push({
      key: "time-filter",
      label: timeFilterLabel(timeFilter, tDates, {
        english: uiLocale === "en",
        locale: intlLocale,
      }),
      onRemove: searchBarProps.onRemoveTimeFilter,
    });
  }
  for (const type of filterTags) {
    chips.push({
      key: `type-${type}`,
      label: tTypes(type),
      onRemove: () => searchBarProps.onRemoveFilter(type),
    });
  }
  const noteText = foundNothing
    ? searchNoteText(
        searchTerms,
        searchHasFilters({
          filterTags,
          hexFilters,
          hueFilters,
          qualifierChips: searchBarProps.qualifierChips,
          showFavoritesOnly,
          styleFilters,
          tagFilter,
          timeFilter,
        })
      )
    : null;

  return { applySuggestion, chips, noteText, suggestion };
}
