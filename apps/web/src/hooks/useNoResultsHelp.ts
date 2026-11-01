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

/**
 * What the empty state of a search offers: each of its filters as a chip to
 * drop, and a "Did you mean" built from the person's own tags, folder names
 * and card titles. The tags are read only once a search has found nothing.
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
    searchBarProps,
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
  return { chips, suggestion, applySuggestion };
}
