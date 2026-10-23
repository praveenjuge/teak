import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import {
  type CardListSort,
  combineSearchQueries,
  expressionFolderNames,
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
  visualFiltersFromUrl,
  withTypeQualifiersAsFilters,
} from "../lib/cardsSearchState";
import { isImeComposing } from "../lib/keyboardShortcuts";
import {
  type LibraryView,
  libraryViewFlags,
  quickCommandTarget,
} from "../lib/libraryViews";
import {
  comparableSearch,
  isSeededSort,
  type LibrarySort,
  queryOrder,
  type SearchUrlState,
  sameMembers,
} from "../lib/searchUrlState";
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
  const [storedSearchState, setStoredSearchState] = useState<CardsSearchState>(
    () => ({
      ...initialCardsSearchState(initialUrlState, { weekStart }),
      ...initialVisualFilters,
    })
  );
  // Every change goes through here, so a `type:` qualifier, however it was
  // added, lands in the type filter the View menu shows.
  const setSearchState = useCallback(
    (update: (prev: CardsSearchState) => CardsSearchState) => {
      setStoredSearchState((prev) => withTypeQualifiersAsFilters(update(prev)));
    },
    []
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
  const [sortPicked, setSortPicked] = useState(
    () => initialUrlState?.sortPicked === true
  );
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
  // Newest over a search's Best match is a choice the URL has to name.
  const newestPicked =
    librarySort === "newest" && sortPicked && canSortByRelevance;
  const urlState = useMemo<SearchUrlState>(
    () => ({
      q: remoteSearchTerms,
      ...(shuffleSeed === undefined ? {} : { seed: shuffleSeed }),
      sort: librarySort,
      ...(newestPicked ? { sortPicked: true } : {}),
      tag: searchState.tagFilter,
      types: searchState.filterTags,
      ...(searchState.styleFilters.length > 0
        ? { styles: searchState.styleFilters }
        : {}),
      ...(searchState.hueFilters.length > 0
        ? { hues: searchState.hueFilters }
        : {}),
      ...(searchState.hexFilters.length > 0
        ? { hexes: searchState.hexFilters }
        : {}),
      ...(searchState.timeFilter ? { date: searchState.timeFilter.label } : {}),
    }),
    [
      librarySort,
      newestPicked,
      remoteSearchTerms,
      searchState.filterTags,
      searchState.hexFilters,
      searchState.hueFilters,
      searchState.styleFilters,
      searchState.tagFilter,
      searchState.timeFilter,
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
    return (
      parsed.folders.length > 0 ||
      expressionFolderNames(parsed.expression).length > 0 ||
      Boolean(parsed.similarity)
    );
  }, [localSearchTerms]);

  const localSearchResults = useMemo(() => {
    // Without a search the grid shows the remote list as is
    // (`mergeLocalAndRemoteSearchResults`), so filtering the cache is waste.
    if (!hasActiveSearch || hasFolderQualifier || localSearchTerms === null) {
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
    hasActiveSearch,
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

  const onSearchChange = useCallback(
    (value: string) => {
      setSearchState((prev) => ({
        ...prev,
        searchQuery: value,
      }));
    },
    [setSearchState]
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (isImeComposing(e)) {
        return;
      }
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
    [onNavigateView, setSearchState, view, weekStart]
  );

  const addFilter = useCallback(
    (filter: CardType) => {
      setSearchState((prev) => {
        if (prev.filterTags.includes(filter)) {
          return prev;
        }
        return {
          ...prev,
          filterTags: [...prev.filterTags, filter],
        };
      });
    },
    [setSearchState]
  );

  const addQualifier = useCallback(
    (qualifier: string) => {
      const chips = qualifierChipsFromText(qualifier);
      if (chips.length === 0) {
        return;
      }
      setSearchState((prev) => ({
        ...prev,
        qualifierChips: addChips(prev.qualifierChips, chips),
      }));
    },
    [setSearchState]
  );

  const addKeywordTag = useCallback(
    (keyword: string) => {
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
    },
    [setSearchState]
  );

  const clearAllFilters = useCallback(() => {
    setSearchState(() => createInitialCardsSearchState());
  }, [setSearchState]);

  const applyUrlState = useCallback(
    (state: SearchUrlState, options?: { keepSearch?: boolean }) => {
      const keepSearch = options?.keepSearch ?? false;
      const search = comparableSearch(state);
      if (!keepSearch) {
        setDebouncedSearchQuery(search.q);
      }
      const visual = visualFiltersFromUrl(state, { weekStart });
      setSearchState((prev) => {
        const sameTerms =
          keepSearch || isSameSearch(buildCardsSearchTerms(prev), search.q);
        const sameTypes = sameMembers(prev.filterTags, search.types);
        const sameStyles = sameMembers(prev.styleFilters, visual.styleFilters);
        const sameHues = sameMembers(prev.hueFilters, visual.hueFilters);
        const sameHexes = sameMembers(prev.hexFilters, visual.hexFilters);
        const sameTime =
          (prev.timeFilter?.label ?? "").toLowerCase() ===
          (visual.timeFilter?.label ?? "").toLowerCase();
        const tag = state.tag ?? "";
        if (
          sameTerms &&
          sameTypes &&
          sameStyles &&
          sameHues &&
          sameHexes &&
          sameTime &&
          prev.tagFilter === tag
        ) {
          return prev;
        }
        return {
          ...prev,
          ...(sameTerms ? {} : cardsSearchStateFromQuery(search.q)),
          filterTags: sameTypes ? prev.filterTags : search.types,
          hexFilters: sameHexes ? prev.hexFilters : visual.hexFilters,
          hueFilters: sameHues ? prev.hueFilters : visual.hueFilters,
          styleFilters: sameStyles ? prev.styleFilters : visual.styleFilters,
          tagFilter: tag,
          timeFilter: sameTime ? prev.timeFilter : visual.timeFilter,
        };
      });
      setOrder((prev) => {
        const next = orderFromUrl(state, prev);
        return next.sort === prev.sort && next.seed === prev.seed ? prev : next;
      });
      setSortPicked(state.sortPicked === true);
    },
    [setSearchState, weekStart]
  );

  const setTimeFilter = useCallback(
    (timeFilter: TimeFilter | null) => {
      setSearchState((prev) => ({
        ...prev,
        timeFilter,
      }));
    },
    [setSearchState]
  );

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
      setSearchState,
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
