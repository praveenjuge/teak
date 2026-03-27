import type { Doc } from "@teak/convex/_generated/dataModel";
import {
  classifySearchToken,
  filterLocalCards,
  mergeCardsIntoLocalSearchCache,
  mergeLocalAndRemoteSearchResults,
  parseTimeSearchQuery,
  resolveQuickSearchCommand,
  SEARCH_LOCAL_SEARCH_CACHE_LIMIT,
  type TimeFilter,
} from "@teak/convex/shared";
import type {
  CardType,
  ColorHueBucket,
  VisualStyle,
} from "@teak/convex/shared/constants";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import type { SearchBarProps } from "../components/search";

export interface CardsSearchState {
  filterTags: CardType[];
  hexFilters: string[];
  hueFilters: ColorHueBucket[];
  keywordTags: string[];
  searchQuery: string;
  showFavoritesOnly: boolean;
  showTrashOnly: boolean;
  styleFilters: VisualStyle[];
  timeFilter: TimeFilter | null;
}

export interface CardsSearchQueryArgs {
  createdAtRange?: TimeFilter["range"];
  favoritesOnly?: boolean;
  hexFilters?: string[];
  hueFilters?: ColorHueBucket[];
  searchQuery?: string;
  showTrashOnly?: boolean;
  styleFilters?: VisualStyle[];
  types?: CardType[];
}

export interface UseCardsSearchControllerOptions {
  localSearchCacheLimit?: number;
  weekStart?: 0 | 1;
}

export interface UseCardsSearchControllerResult {
  addFilter: (filter: CardType) => void;
  addKeywordTag: (keyword: string) => void;
  clearAllFilters: () => void;
  displayCards: Doc<"cards">[];
  filterTags: CardType[];
  hasActiveSearch: boolean;
  hasNoFilters: boolean;
  hexFilters: string[];
  hueFilters: ColorHueBucket[];
  keywordTags: string[];
  queryArgs: CardsSearchQueryArgs;
  resetKey: string;
  searchBarProps: Omit<SearchBarProps, "SettingsButton">;
  searchQuery: string;
  searchTerms: string;
  setRemoteCards: (cards: Doc<"cards">[] | undefined) => void;
  setTimeFilter: (timeFilter: TimeFilter | null) => void;
  showFavoritesOnly: boolean;
  showTrashOnly: boolean;
  styleFilters: VisualStyle[];
  timeFilter: TimeFilter | null;
}

export function createInitialCardsSearchState(): CardsSearchState {
  return {
    searchQuery: "",
    keywordTags: [],
    filterTags: [],
    styleFilters: [],
    hueFilters: [],
    hexFilters: [],
    showFavoritesOnly: false,
    showTrashOnly: false,
    timeFilter: null,
  };
}

export function buildCardsSearchTerms(state: CardsSearchState): string {
  return [
    ...state.keywordTags,
    ...(state.searchQuery.trim() ? [state.searchQuery.trim()] : []),
  ].join(" ");
}

export function buildCardsSearchQueryArgs(
  state: CardsSearchState
): CardsSearchQueryArgs {
  const searchTerms = buildCardsSearchTerms(state);
  return {
    searchQuery: searchTerms || undefined,
    types: state.filterTags.length > 0 ? state.filterTags : undefined,
    favoritesOnly: state.showFavoritesOnly || undefined,
    showTrashOnly: state.showTrashOnly || undefined,
    styleFilters:
      state.styleFilters.length > 0 ? state.styleFilters : undefined,
    hueFilters: state.hueFilters.length > 0 ? state.hueFilters : undefined,
    hexFilters: state.hexFilters.length > 0 ? state.hexFilters : undefined,
    createdAtRange: state.timeFilter?.range,
  };
}

export function getHasActiveSearch(state: CardsSearchState): boolean {
  return Boolean(
    buildCardsSearchTerms(state) ||
      state.filterTags.length > 0 ||
      state.styleFilters.length > 0 ||
      state.hueFilters.length > 0 ||
      state.hexFilters.length > 0 ||
      state.showFavoritesOnly ||
      state.showTrashOnly ||
      state.timeFilter
  );
}

export function getHasNoFilters(state: CardsSearchState): boolean {
  return (
    state.keywordTags.length === 0 &&
    state.filterTags.length === 0 &&
    state.styleFilters.length === 0 &&
    state.hueFilters.length === 0 &&
    state.hexFilters.length === 0 &&
    !state.showFavoritesOnly &&
    !state.showTrashOnly &&
    !state.searchQuery &&
    !state.timeFilter
  );
}

export function buildCardsSearchResetKey(state: CardsSearchState): string {
  const searchTerms = buildCardsSearchTerms(state);
  return `${searchTerms}::${state.filterTags.join(",")}::${state.styleFilters.join(",")}::${state.hueFilters.join(",")}::${state.hexFilters.join(",")}::${state.showFavoritesOnly}::${state.showTrashOnly}::${state.timeFilter?.range.start ?? ""}-${state.timeFilter?.range.end ?? ""}`;
}

export function applyEnterToCardsSearchState(
  state: CardsSearchState,
  options: {
    now?: Date;
    weekStart?: 0 | 1;
  } = {}
): CardsSearchState {
  if (!state.searchQuery.trim()) {
    return state;
  }

  const parsedTime = parseTimeSearchQuery(state.searchQuery, {
    now: options.now ?? new Date(),
    weekStart: options.weekStart ?? 0,
  });

  if (parsedTime) {
    return {
      ...state,
      timeFilter: parsedTime,
      searchQuery: "",
    };
  }

  const quickCommand = resolveQuickSearchCommand(state.searchQuery);
  if (quickCommand === "favorites") {
    return {
      ...state,
      showFavoritesOnly: !state.showFavoritesOnly,
      searchQuery: "",
    };
  }

  if (quickCommand === "trash") {
    return {
      ...state,
      showTrashOnly: !state.showTrashOnly,
      searchQuery: "",
    };
  }

  const styleAdditions: VisualStyle[] = [];
  const hueAdditions: ColorHueBucket[] = [];
  const hexAdditions: string[] = [];
  const keywordAdditions: string[] = [];

  for (const token of state.searchQuery.split(/\s+/)) {
    const classified = classifySearchToken(token);
    if (!classified) {
      continue;
    }

    if (classified.kind === "style") {
      if (
        !(
          state.styleFilters.includes(classified.value) ||
          styleAdditions.includes(classified.value)
        )
      ) {
        styleAdditions.push(classified.value);
      }
      continue;
    }

    if (classified.kind === "hue") {
      if (
        !(
          state.hueFilters.includes(classified.value) ||
          hueAdditions.includes(classified.value)
        )
      ) {
        hueAdditions.push(classified.value);
      }
      continue;
    }

    if (classified.kind === "hex") {
      if (
        !(
          state.hexFilters.includes(classified.value) ||
          hexAdditions.includes(classified.value)
        )
      ) {
        hexAdditions.push(classified.value);
      }
      continue;
    }

    if (
      !(
        state.keywordTags.includes(classified.value) ||
        keywordAdditions.includes(classified.value)
      )
    ) {
      keywordAdditions.push(classified.value);
    }
  }

  return {
    ...state,
    styleFilters:
      styleAdditions.length > 0
        ? [...state.styleFilters, ...styleAdditions]
        : state.styleFilters,
    hueFilters:
      hueAdditions.length > 0
        ? [...state.hueFilters, ...hueAdditions]
        : state.hueFilters,
    hexFilters:
      hexAdditions.length > 0
        ? [...state.hexFilters, ...hexAdditions]
        : state.hexFilters,
    keywordTags:
      keywordAdditions.length > 0
        ? [...state.keywordTags, ...keywordAdditions]
        : state.keywordTags,
    searchQuery: "",
  };
}

export function applyBackspaceToCardsSearchState(
  state: CardsSearchState
): CardsSearchState {
  if (state.searchQuery !== "" || getHasNoFilters(state)) {
    return state;
  }

  if (state.hexFilters.length > 0) {
    return {
      ...state,
      hexFilters: state.hexFilters.slice(0, -1),
    };
  }

  if (state.hueFilters.length > 0) {
    return {
      ...state,
      hueFilters: state.hueFilters.slice(0, -1),
    };
  }

  if (state.styleFilters.length > 0) {
    return {
      ...state,
      styleFilters: state.styleFilters.slice(0, -1),
    };
  }

  if (state.showTrashOnly) {
    return {
      ...state,
      showTrashOnly: false,
    };
  }

  if (state.showFavoritesOnly) {
    return {
      ...state,
      showFavoritesOnly: false,
    };
  }

  if (state.filterTags.length > 0) {
    return {
      ...state,
      filterTags: state.filterTags.slice(0, -1),
    };
  }

  if (state.timeFilter) {
    return {
      ...state,
      timeFilter: null,
    };
  }

  if (state.keywordTags.length > 0) {
    return {
      ...state,
      keywordTags: state.keywordTags.slice(0, -1),
    };
  }

  return state;
}

export function useCardsSearchController(
  options: UseCardsSearchControllerOptions = {}
): UseCardsSearchControllerResult {
  const {
    weekStart = 0,
    localSearchCacheLimit = SEARCH_LOCAL_SEARCH_CACHE_LIMIT,
  } = options;
  const [searchState, setSearchState] = useState(createInitialCardsSearchState);
  const [remoteCards, setRemoteCardsState] = useState<Doc<"cards">[]>([]);
  const [localCards, setLocalCards] = useState<Doc<"cards">[]>([]);

  const setRemoteCards = useCallback(
    (cards: Doc<"cards">[] | undefined) => {
      const nextCards = cards ?? [];
      setRemoteCardsState(nextCards);

      if (nextCards.length === 0) {
        return;
      }

      setLocalCards((prev) =>
        mergeCardsIntoLocalSearchCache(prev, nextCards, localSearchCacheLimit)
      );
    },
    [localSearchCacheLimit]
  );

  const searchTerms = useMemo(
    () => buildCardsSearchTerms(searchState),
    [searchState]
  );

  const deferredSearchQuery = useDeferredValue(searchState.searchQuery);

  const queryArgs = useMemo(
    () =>
      buildCardsSearchQueryArgs({
        ...searchState,
        searchQuery: deferredSearchQuery,
      }),
    [deferredSearchQuery, searchState]
  );

  const hasActiveSearch = useMemo(
    () => getHasActiveSearch(searchState),
    [searchState]
  );

  const localSearchResults = useMemo(
    () =>
      filterLocalCards(localCards, {
        searchTerms,
        types: searchState.filterTags,
        styleFilters: searchState.styleFilters,
        hueFilters: searchState.hueFilters,
        hexFilters: searchState.hexFilters,
        favoritesOnly: searchState.showFavoritesOnly,
        showTrashOnly: searchState.showTrashOnly,
        createdAtRange: searchState.timeFilter?.range,
      }),
    [localCards, searchState, searchTerms]
  );

  const suppressRemoteCards =
    hasActiveSearch && deferredSearchQuery !== searchState.searchQuery;

  const displayCards = useMemo(
    () =>
      mergeLocalAndRemoteSearchResults(
        suppressRemoteCards ? [] : remoteCards,
        localSearchResults,
        hasActiveSearch
      ),
    [hasActiveSearch, localSearchResults, remoteCards, suppressRemoteCards]
  );

  const resetKey = useMemo(
    () => buildCardsSearchResetKey(searchState),
    [searchState]
  );

  const hasNoFilters = useMemo(
    () => getHasNoFilters(searchState),
    [searchState]
  );

  const onSearchChange = useCallback((value: string) => {
    setSearchState((prev) => ({
      ...prev,
      searchQuery: value,
    }));
  }, []);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        setSearchState((prev) =>
          applyEnterToCardsSearchState(prev, { weekStart, now: new Date() })
        );
        return;
      }

      if (e.key === "Backspace") {
        setSearchState((prev) => applyBackspaceToCardsSearchState(prev));
      }
    },
    [weekStart]
  );

  const addFilter = useCallback((filter: CardType) => {
    setSearchState((prev) => {
      if (prev.filterTags.includes(filter)) {
        return prev;
      }
      return {
        ...prev,
        filterTags: [...prev.filterTags, filter],
      };
    });
  }, []);

  const addKeywordTag = useCallback((keyword: string) => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      return;
    }

    setSearchState((prev) => {
      if (prev.keywordTags.includes(normalizedKeyword)) {
        return prev;
      }
      return {
        ...prev,
        keywordTags: [...prev.keywordTags, normalizedKeyword],
      };
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setSearchState(createInitialCardsSearchState());
  }, []);

  const setTimeFilter = useCallback((timeFilter: TimeFilter | null) => {
    setSearchState((prev) => ({
      ...prev,
      timeFilter,
    }));
  }, []);

  const searchBarProps = useMemo<Omit<SearchBarProps, "SettingsButton">>(
    () => ({
      searchQuery: searchState.searchQuery,
      onSearchChange,
      onKeyDown,
      keywordTags: searchState.keywordTags,
      timeFilter: searchState.timeFilter,
      filterTags: searchState.filterTags,
      styleFilters: searchState.styleFilters,
      hueFilters: searchState.hueFilters,
      hexFilters: searchState.hexFilters,
      showFavoritesOnly: searchState.showFavoritesOnly,
      showTrashOnly: searchState.showTrashOnly,
      onAddFilter: addFilter,
      onRemoveFilter: (filter) =>
        setSearchState((prev) => ({
          ...prev,
          filterTags: prev.filterTags.filter((tag) => tag !== filter),
        })),
      onRemoveStyleFilter: (style) =>
        setSearchState((prev) => ({
          ...prev,
          styleFilters: prev.styleFilters.filter(
            (activeStyle) => activeStyle !== style
          ),
        })),
      onRemoveHueFilter: (hue) =>
        setSearchState((prev) => ({
          ...prev,
          hueFilters: prev.hueFilters.filter((activeHue) => activeHue !== hue),
        })),
      onRemoveHexFilter: (hex) =>
        setSearchState((prev) => ({
          ...prev,
          hexFilters: prev.hexFilters.filter((activeHex) => activeHex !== hex),
        })),
      onRemoveKeyword: (keyword) =>
        setSearchState((prev) => ({
          ...prev,
          keywordTags: prev.keywordTags.filter((tag) => tag !== keyword),
        })),
      onRemoveTimeFilter: () =>
        setSearchState((prev) => ({
          ...prev,
          timeFilter: null,
        })),
      onToggleFavorites: () =>
        setSearchState((prev) => ({
          ...prev,
          showFavoritesOnly: !prev.showFavoritesOnly,
        })),
      onToggleTrash: () =>
        setSearchState((prev) => ({
          ...prev,
          showTrashOnly: !prev.showTrashOnly,
        })),
      onClearAll: clearAllFilters,
    }),
    [addFilter, clearAllFilters, onKeyDown, onSearchChange, searchState]
  );

  return {
    searchQuery: searchState.searchQuery,
    keywordTags: searchState.keywordTags,
    filterTags: searchState.filterTags,
    styleFilters: searchState.styleFilters,
    hueFilters: searchState.hueFilters,
    hexFilters: searchState.hexFilters,
    showFavoritesOnly: searchState.showFavoritesOnly,
    showTrashOnly: searchState.showTrashOnly,
    timeFilter: searchState.timeFilter,
    searchTerms,
    queryArgs,
    hasActiveSearch,
    displayCards,
    resetKey,
    hasNoFilters,
    setRemoteCards,
    setTimeFilter,
    addFilter,
    addKeywordTag,
    clearAllFilters,
    searchBarProps,
  };
}
