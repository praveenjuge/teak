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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  /** A folder view: every read is limited to this folder's cards. */
  folderId?: Id<"folders">;
  /**
   * A smart folder's search (its view's `folderId` is the smart folder):
   * its cards are what this and the typed search both match.
   */
  folderQuery?: string;
  /** The search to start with, usually read from the page URL. */
  initialUrlState?: SearchUrlState;
  /** Filters to start with, kept from a screen that was remounted. */
  initialVisualFilters?: CardsVisualFilters;
  localSearchCacheLimit?: number;
  /**
   * Called when a quick command (`fav`, `trash`, `archive`) is entered in a
   * routed view: the app navigates instead of toggling hidden state.
   */
  onNavigateView?: (view: LibraryView) => void;
  /**
   * The routed view (All, Favorites, Archive, Trash). It decides the
   * favorites, archive and trash flags; without it they are toggles.
   */
  view?: LibraryView;
  weekStart?: 0 | 1;
}

/**
 * How long typing must pause before the remote search query changes. Local
 * results from the search cache still update on every keystroke.
 */
export const REMOTE_SEARCH_DEBOUNCE_MS = 200;

export interface UseCardsSearchControllerResult {
  addFilter: (filter: CardType) => void;
  addKeywordTag: (keyword: string) => void;
  /** Adds a qualifier chip (`site:github.com`); invalid text is ignored. */
  addQualifier: (qualifier: string) => void;
  /**
   * Replaces the search with one from the URL (back, forward or a pasted
   * link): the text becomes the typed query and chips are cleared. With
   * `keepSearch`, only the types and sort follow the URL, so text still
   * being typed survives a change made elsewhere (a sidebar type).
   */
  applyUrlState: (
    state: SearchUrlState,
    options?: { keepSearch?: boolean }
  ) => void;
  clearAllFilters: () => void;
  displayCards: Doc<"cards">[];
  filterTags: CardType[];
  hasActiveSearch: boolean;
  hasNoFilters: boolean;
  /** True when nothing narrows the current view (search, chips or types). */
  hasNoSearchFilters: boolean;
  hexFilters: string[];
  hueFilters: ColorHueBucket[];
  /** True while typed text waits for the debounce before querying remotely. */
  isSearchPending: boolean;
  keywordTags: string[];
  /** The sort as chosen, Revisit included; `sort` is how it queries. */
  librarySort: LibrarySort;
  qualifierChips: string[];
  queryArgs: CardsSearchQueryArgs;
  resetKey: string;
  /**
   * Shuffle again with a new seed (switching to Shuffle if needed); in
   * Revisit, deal again from a new seed.
   */
  reshuffle: () => void;
  searchBarProps: SearchBarProps;
  searchQuery: string;
  searchTerms: string;
  /**
   * Feed the latest remote results into the controller. Pass the key of the
   * query that produced them (e.g. `JSON.stringify(queryArgs)`) so cards the
   * same query stops returning (deleted elsewhere) leave the local cache.
   */
  setRemoteCards: (
    cards: Doc<"cards">[] | undefined,
    remoteQueryKey?: string
  ) => void;
  setSort: (sort: LibrarySort) => void;
  setTimeFilter: (timeFilter: TimeFilter | null) => void;
  showArchivedOnly: boolean;
  showFavoritesOnly: boolean;
  showTrashOnly: boolean;
  /** Shuffle's seed while the sort is Shuffle (or Revisit). */
  shuffleSeed?: number;
  sort: CardListSort;
  styleFilters: VisualStyle[];
  tagFilter: string;
  timeFilter: TimeFilter | null;
  updateCachedCard: (card: Doc<"cards">) => void;
  /**
   * The settled search to mirror into the URL: the debounced terms, the sort
   * and the card types. Changes only once typing pauses, so URL writes stay
   * infrequent.
   */
  urlState: SearchUrlState;
}

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
  // Whether the person chose an order during this search; Best match stays
  // the default until they do.
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
      // Revisit deals again from the new seed; anything else shuffles.
      sort: prev.sort === "revisit" ? "revisit" : "shuffle",
    }));
  }, []);
  const [remoteCards, setRemoteCardsState] = useState<Doc<"cards">[]>([]);
  // The query the remote cards answer, as the screen keys it.
  const [remoteCardsKey, setRemoteCardsKey] = useState<string | undefined>();
  const [localCards, setLocalCards] = useState<Doc<"cards">[]>([]);
  const lastRemoteResultRef = useRef<{
    ids: ReadonlySet<string>;
    key: string;
  } | null>(null);

  const setRemoteCards = useCallback(
    (cards: Doc<"cards">[] | undefined, remoteQueryKey?: string) => {
      const nextCards = cards ?? [];
      setRemoteCardsState(nextCards);
      setRemoteCardsKey(remoteQueryKey);

      const previousResult = lastRemoteResultRef.current;
      const previousRemoteIds =
        remoteQueryKey !== undefined && previousResult?.key === remoteQueryKey
          ? previousResult.ids
          : new Set<string>();
      lastRemoteResultRef.current =
        remoteQueryKey === undefined
          ? null
          : {
              ids: new Set(nextCards.map((card) => card._id)),
              key: remoteQueryKey,
            };

      setLocalCards((prev) =>
        mergeCardsIntoLocalSearchCache(
          pruneCardsMissingFromRemote(prev, previousRemoteIds, nextCards),
          nextCards,
          localSearchCacheLimit
        )
      );
    },
    [localSearchCacheLimit]
  );

  const updateCachedCard = useCallback((card: Doc<"cards">) => {
    const replaceCard = (cards: Doc<"cards">[]) =>
      cards.map((cachedCard) =>
        cachedCard._id === card._id ? card : cachedCard
      );
    setRemoteCardsState(replaceCard);
    setLocalCards(replaceCard);
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

  // A click (a link, a card, a sidebar view) ends the typing, so apply the
  // text before the click's own handlers run. Mirrored into the URL after a
  // navigation has started, it would cancel that navigation.
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
  // Remote cards answer the words typed now: their query is the current one.
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
      // A search from the URL is not typing: query it at once, so the screen
      // never reports the previous search back into the URL meanwhile.
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
