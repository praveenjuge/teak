import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import {
  type CardListSort,
  combineSearchQueries,
  filterLocalCards,
  mergeCardsIntoLocalSearchCache,
  mergeLocalAndRemoteSearchResults,
  parseSearchQuery,
  pruneCardsMissingFromRemote,
  resolveQuickSearchCommand,
  SEARCH_LOCAL_SEARCH_CACHE_LIMIT,
  shuffleBySeed,
  type TimeFilter,
} from "@teak/convex/shared";
import type {
  CardType,
  ColorHueBucket,
  VisualStyle,
} from "@teak/convex/shared/constants";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import type { SearchBarProps } from "../components/search";
import {
  type LibraryView,
  libraryViewFlags,
  quickCommandTarget,
} from "../lib/libraryViews";
import {
  isSeededSort,
  type LibrarySort,
  queryOrder,
  type SearchUrlState,
} from "../lib/searchUrlState";
import {
  addChips,
  applyBackspaceToCardsSearchState,
  applyEnterToCardsSearchState,
  buildCardsSearchQueryArgs,
  buildCardsSearchResetKey,
  buildCardsSearchTerms,
  type CardsOrder,
  type CardsSearchQueryArgs,
  type CardsSearchState,
  type CardsVisualFilters,
  cardsSearchStateFromQuery,
  createInitialCardsSearchState,
  effectiveCardsOrder,
  getHasActiveSearch,
  getHasNoFilters,
  initialCardsSearchState,
  isSameSearch,
  nextShuffleSeed,
  orderFromUrl,
  orderQueryArgs,
  qualifierChipsFromText,
} from "./cardsSearchState";
import { semanticSearchText } from "./useSemanticSearch";

export interface UseCardsSearchControllerOptions {
  folderId?: Id<"folders">;
  folderQuery?: string;
  initialUrlState?: SearchUrlState;
  initialVisualFilters?: CardsVisualFilters;
  localSearchCacheLimit?: number;
  onNavigateView?: (view: LibraryView) => void;
  view?: LibraryView;
  weekStart?: 0 | 1;
}

export const REMOTE_SEARCH_DEBOUNCE_MS = 200;

export interface UseCardsSearchControllerResult {
  addFilter: (filter: CardType) => void;
  addKeywordTag: (keyword: string) => void;
  addQualifier: (qualifier: string) => void;
  applyUrlState: (
    state: SearchUrlState,
    options?: { keepSearch?: boolean }
  ) => void;
  clearAllFilters: () => void;
  displayCards: Doc<"cards">[];
  filterTags: CardType[];
  hasActiveSearch: boolean;
  hasNoFilters: boolean;
  hasNoSearchFilters: boolean;
  hexFilters: string[];
  hueFilters: ColorHueBucket[];
  isSearchPending: boolean;
  keywordTags: string[];
  librarySort: LibrarySort;
  qualifierChips: string[];
  queryArgs: CardsSearchQueryArgs;
  resetKey: string;
  reshuffle: () => void;
  searchBarProps: SearchBarProps;
  searchQuery: string;
  searchTerms: string;
  setRemoteCards: (
    cards: Doc<"cards">[] | undefined,
    remoteQueryKey?: string
  ) => void;
  setSort: (sort: LibrarySort) => void;
  setTimeFilter: (timeFilter: TimeFilter | null) => void;
  showArchivedOnly: boolean;
  showFavoritesOnly: boolean;
  showTrashOnly: boolean;
  shuffleSeed?: number;
  sort: CardListSort;
  styleFilters: VisualStyle[];
  tagFilter: string;
  timeFilter: TimeFilter | null;
  updateCachedCard: (card: Doc<"cards">) => void;
  urlState: SearchUrlState;
}

interface SearchResultsCache {
  localCards: Doc<"cards">[];
  remoteCards: Doc<"cards">[];
  remoteKey?: string;
}

const EMPTY_RESULTS_CACHE: SearchResultsCache = {
  localCards: [],
  remoteCards: [],
};

export function useCardsSearchController(
  options: UseCardsSearchControllerOptions = {}
): UseCardsSearchControllerResult {
  const {
    weekStart = 0,
    localSearchCacheLimit = SEARCH_LOCAL_SEARCH_CACHE_LIMIT,
    initialUrlState,
    initialVisualFilters,
    onNavigateView,
    view,
    folderId,
    folderQuery,
  } = options;
  const [storedSearchState, setSearchState] = useState<CardsSearchState>(
    () => ({
      ...initialCardsSearchState(initialUrlState),
      ...initialVisualFilters,
    })
  );
  const searchState = useMemo<CardsSearchState>(
    () =>
      view === undefined
        ? storedSearchState
        : { ...storedSearchState, ...libraryViewFlags(view) },
    [storedSearchState, view]
  );
  const [order, setOrder] = useState<CardsOrder>(() =>
    orderFromUrl(initialUrlState)
  );
  const [sortPicked, setSortPicked] = useState(false);
  const setSort = useCallback((next: LibrarySort) => {
    setSortPicked(true);
    setOrder((prev) => {
      if (prev.sort === next) {
        return prev;
      }
      return isSeededSort(next)
        ? { seed: nextShuffleSeed(), sort: next }
        : { sort: next };
    });
  }, []);
  const reshuffle = useCallback(() => {
    setOrder((prev) => ({
      seed: nextShuffleSeed(isSeededSort(prev.sort) ? prev.seed : undefined),
      sort: prev.sort === "revisit" ? "revisit" : "shuffle",
    }));
  }, []);
  const [results, setResults] =
    useState<SearchResultsCache>(EMPTY_RESULTS_CACHE);
  const { localCards, remoteCards, remoteKey: remoteCardsKey } = results;

  const setRemoteCards = useCallback(
    (cards: Doc<"cards">[] | undefined, remoteQueryKey?: string) => {
      const nextCards = cards ?? [];
      setResults((prev) => {
        const previousRemoteIds =
          remoteQueryKey !== undefined && prev.remoteKey === remoteQueryKey
            ? new Set(prev.remoteCards.map((card) => card._id))
            : new Set<string>();
        return {
          localCards: mergeCardsIntoLocalSearchCache(
            pruneCardsMissingFromRemote(
              prev.localCards,
              previousRemoteIds,
              nextCards
            ),
            nextCards,
            localSearchCacheLimit
          ),
          remoteCards: nextCards,
          remoteKey: remoteQueryKey,
        };
      });
    },
    [localSearchCacheLimit]
  );

  const updateCachedCard = useCallback((card: Doc<"cards">) => {
    const replaceCard = (cards: Doc<"cards">[]) =>
      cards.map((cachedCard) =>
        cachedCard._id === card._id ? card : cachedCard
      );
    setResults((prev) => ({
      ...prev,
      localCards: replaceCard(prev.localCards),
      remoteCards: replaceCard(prev.remoteCards),
    }));
  }, []);

  const searchTerms = useMemo(
    () => buildCardsSearchTerms(searchState),
    [searchState]
  );

  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(
    () => searchState.searchQuery
  );
  const isSearchQueryEmpty = searchState.searchQuery.trim() === "";

  useEffect(() => {
    if (isSearchQueryEmpty) {
      setDebouncedSearchQuery(searchState.searchQuery);
      return;
    }

    const timeout = setTimeout(
      () => setDebouncedSearchQuery(searchState.searchQuery),
      REMOTE_SEARCH_DEBOUNCE_MS
    );
    return () => clearTimeout(timeout);
  }, [isSearchQueryEmpty, searchState.searchQuery]);

  // A URL write after a navigation has started cancels that navigation, so
  // a click applies the typed text before its own handlers run.
  useEffect(() => {
    if (
      isSearchQueryEmpty ||
      debouncedSearchQuery === searchState.searchQuery
    ) {
      return;
    }
    const applyTypedSearch = () => {
      flushSync(() => setDebouncedSearchQuery(searchState.searchQuery));
    };
    document.addEventListener("click", applyTypedSearch, { capture: true });
    return () => {
      document.removeEventListener("click", applyTypedSearch, {
        capture: true,
      });
    };
  }, [debouncedSearchQuery, isSearchQueryEmpty, searchState.searchQuery]);

  const remoteSearchQuery = isSearchQueryEmpty
    ? searchState.searchQuery
    : debouncedSearchQuery;

  const canSortByRelevance =
    semanticSearchText(remoteSearchQuery, folderQuery) !== "";
  useEffect(() => {
    if (!canSortByRelevance) {
      setSortPicked(false);
    }
  }, [canSortByRelevance]);
  const effectiveOrder = useMemo(
    () => effectiveCardsOrder(order, canSortByRelevance, sortPicked),
    [canSortByRelevance, order, sortPicked]
  );
  const librarySort = effectiveOrder.sort;
  const { shuffleSeed, sort } = queryOrder(effectiveOrder);

  const queryArgs = useMemo(
    () => ({
      ...buildCardsSearchQueryArgs({
        ...searchState,
        searchQuery: remoteSearchQuery,
      }),
      ...orderQueryArgs(effectiveOrder),
      ...(folderId ? { folderId } : {}),
      ...(folderId && folderQuery !== undefined ? { folderQuery } : {}),
    }),
    [folderId, folderQuery, effectiveOrder, remoteSearchQuery, searchState]
  );

  const remoteSearchTerms = queryArgs.searchQuery ?? "";
  const urlState = useMemo<SearchUrlState>(
    () => ({
      q: remoteSearchTerms,
      ...(shuffleSeed === undefined ? {} : { seed: shuffleSeed }),
      sort: librarySort,
      tag: searchState.tagFilter,
      types: searchState.filterTags,
    }),
    [
      librarySort,
      remoteSearchTerms,
      searchState.filterTags,
      searchState.tagFilter,
      shuffleSeed,
    ]
  );

  const hasActiveSearch = useMemo(
    () => getHasActiveSearch(searchState),
    [searchState]
  );

  const localSearchTerms = useMemo(
    () =>
      folderQuery === undefined
        ? searchTerms
        : combineSearchQueries(folderQuery, searchTerms),
    [folderQuery, searchTerms]
  );

  const hasFolderQualifier = useMemo(() => {
    if (localSearchTerms === null) {
      return true;
    }
    const parsed = parseSearchQuery(localSearchTerms);
    return parsed.folders.length > 0 || Boolean(parsed.similarity);
  }, [localSearchTerms]);

  const localSearchResults = useMemo(() => {
    if (hasFolderQualifier || localSearchTerms === null) {
      return [];
    }
    const matches = filterLocalCards(
      folderId && folderQuery === undefined
        ? localCards.filter((card) => (card.folderIds ?? []).includes(folderId))
        : localCards,
      {
        searchTerms: localSearchTerms,
        types: searchState.filterTags,
        styleFilters: searchState.styleFilters,
        hueFilters: searchState.hueFilters,
        hexFilters: searchState.hexFilters,
        favoritesOnly: searchState.showFavoritesOnly,
        showTrashOnly: searchState.showTrashOnly,
        showArchivedOnly: searchState.showArchivedOnly,
        createdAtRange: searchState.timeFilter?.range,
        sort,
        tag: searchState.tagFilter,
      }
    );
    return shuffleSeed === undefined
      ? matches
      : shuffleBySeed(matches, shuffleSeed, (card) => card._id);
  }, [
    folderId,
    folderQuery,
    hasFolderQualifier,
    localCards,
    localSearchTerms,
    searchState,
    shuffleSeed,
    sort,
  ]);

  const isSearchPending = remoteSearchQuery !== searchState.searchQuery;
  const remoteCardsAreCurrent =
    !isSearchPending && remoteCardsKey === JSON.stringify(queryArgs);

  const remoteSearchResults = useMemo(() => {
    if (!hasActiveSearch) {
      return remoteCards;
    }
    if (localSearchTerms === null) {
      return [];
    }
    return filterLocalCards(remoteCards, {
      searchTerms: localSearchTerms,
      textMatchedByServer: remoteCardsAreCurrent,
      types: searchState.filterTags,
      styleFilters: searchState.styleFilters,
      hueFilters: searchState.hueFilters,
      hexFilters: searchState.hexFilters,
      favoritesOnly: searchState.showFavoritesOnly,
      showTrashOnly: searchState.showTrashOnly,
      showArchivedOnly: searchState.showArchivedOnly,
      createdAtRange: searchState.timeFilter?.range,
      sort,
      tag: searchState.tagFilter,
    });
  }, [
    hasActiveSearch,
    localSearchTerms,
    remoteCards,
    remoteCardsAreCurrent,
    searchState,
    sort,
  ]);

  const displayCards = useMemo(
    () =>
      mergeLocalAndRemoteSearchResults(
        remoteSearchResults,
        localSearchResults,
        hasActiveSearch,
        sort
      ),
    [hasActiveSearch, localSearchResults, remoteSearchResults, sort]
  );

  const resetKey = useMemo(
    () =>
      `${buildCardsSearchResetKey(searchState)}::${sort}${
        shuffleSeed === undefined ? "" : `:${shuffleSeed}`
      }`,
    [searchState, shuffleSeed, sort]
  );

  const hasNoFilters = useMemo(
    () => getHasNoFilters(searchState),
    [searchState]
  );
  const hasNoSearchFilters = useMemo(
    () =>
      getHasNoFilters({
        ...searchState,
        showArchivedOnly: false,
        showFavoritesOnly: false,
        showTrashOnly: false,
      }),
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
        const command = resolveQuickSearchCommand(e.currentTarget.value);
        if (command && view !== undefined && onNavigateView) {
          setSearchState((prev) => ({ ...prev, searchQuery: "" }));
          onNavigateView(quickCommandTarget(command, view));
          return;
        }
        setSearchState((prev) =>
          applyEnterToCardsSearchState(prev, { weekStart, now: new Date() })
        );
        return;
      }

      if (e.key === "Backspace") {
        setSearchState((prev) => applyBackspaceToCardsSearchState(prev));
      }
    },
    [onNavigateView, view, weekStart]
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

  const addQualifier = useCallback((qualifier: string) => {
    const chips = qualifierChipsFromText(qualifier);
    if (chips.length === 0) {
      return;
    }
    setSearchState((prev) => ({
      ...prev,
      qualifierChips: addChips(prev.qualifierChips, chips),
    }));
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

  const applyUrlState = useCallback(
    (state: SearchUrlState, options?: { keepSearch?: boolean }) => {
      const keepSearch = options?.keepSearch ?? false;
      if (!keepSearch) {
        setDebouncedSearchQuery(state.q);
      }
      setSearchState((prev) => {
        const sameTerms =
          keepSearch || isSameSearch(buildCardsSearchTerms(prev), state.q);
        const sameTypes =
          prev.filterTags.length === state.types.length &&
          prev.filterTags.every((type) => state.types.includes(type));
        const tag = state.tag ?? "";
        if (sameTerms && sameTypes && prev.tagFilter === tag) {
          return prev;
        }
        return {
          ...prev,
          ...(sameTerms ? {} : cardsSearchStateFromQuery(state.q)),
          filterTags: sameTypes ? prev.filterTags : state.types,
          tagFilter: tag,
        };
      });
      setOrder((prev) => {
        const next = orderFromUrl(state, prev);
        return next.sort === prev.sort && next.seed === prev.seed ? prev : next;
      });
    },
    []
  );

  const setTimeFilter = useCallback((timeFilter: TimeFilter | null) => {
    setSearchState((prev) => ({
      ...prev,
      timeFilter,
    }));
  }, []);

  const searchBarProps = useMemo<SearchBarProps>(
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
      onRemoveFilter: (filter) =>
        setSearchState((prev) => ({
          ...prev,
          filterTags: prev.filterTags.filter((tag) => tag !== filter),
        })),
      onToggleFilter: (filter) =>
        setSearchState((prev) => ({
          ...prev,
          filterTags: prev.filterTags.includes(filter)
            ? prev.filterTags.filter((tag) => tag !== filter)
            : [...prev.filterTags, filter],
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
      qualifierChips: searchState.qualifierChips,
      onAddQualifier: addQualifier,
      onRemoveQualifier: (qualifier) =>
        setSearchState((prev) => ({
          ...prev,
          qualifierChips: prev.qualifierChips.filter(
            (chip) => chip !== qualifier
          ),
        })),
      onRemoveTimeFilter: () =>
        setSearchState((prev) => ({
          ...prev,
          timeFilter: null,
        })),
      tagFilter: searchState.tagFilter,
      onRemoveTagFilter: () =>
        setSearchState((prev) => ({
          ...prev,
          tagFilter: "",
        })),
      onClearAll: clearAllFilters,
      sort: librarySort,
      canSortByRelevance,
      onSortChange: setSort,
      onReshuffle: reshuffle,
    }),
    [
      addQualifier,
      canSortByRelevance,
      clearAllFilters,
      librarySort,
      onKeyDown,
      onSearchChange,
      reshuffle,
      searchState,
      setSort,
    ]
  );

  return {
    searchQuery: searchState.searchQuery,
    keywordTags: searchState.keywordTags,
    librarySort,
    qualifierChips: searchState.qualifierChips,
    filterTags: searchState.filterTags,
    styleFilters: searchState.styleFilters,
    hueFilters: searchState.hueFilters,
    hexFilters: searchState.hexFilters,
    tagFilter: searchState.tagFilter,
    showArchivedOnly: searchState.showArchivedOnly,
    showFavoritesOnly: searchState.showFavoritesOnly,
    showTrashOnly: searchState.showTrashOnly,
    timeFilter: searchState.timeFilter,
    searchTerms,
    queryArgs,
    hasActiveSearch,
    displayCards,
    isSearchPending,
    resetKey,
    hasNoFilters,
    hasNoSearchFilters,
    setRemoteCards,
    setTimeFilter,
    addFilter,
    addKeywordTag,
    addQualifier,
    applyUrlState,
    clearAllFilters,
    searchBarProps,
    reshuffle,
    setSort,
    shuffleSeed,
    sort,
    updateCachedCard,
    urlState,
  };
}
