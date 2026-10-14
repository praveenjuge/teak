import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import {
  type CardListSort,
  classifySearchToken,
  filterLocalCards,
  mergeCardsIntoLocalSearchCache,
  mergeLocalAndRemoteSearchResults,
  parseTimeSearchQuery,
  pruneCardsMissingFromRemote,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { SearchBarProps } from "../components/search";
import {
  type LibraryView,
  libraryViewFlags,
  quickCommandTarget,
} from "../lib/libraryViews";
import type { SearchUrlState } from "../lib/searchUrlState";

export interface CardsSearchState {
  filterTags: CardType[];
  hexFilters: string[];
  hueFilters: ColorHueBucket[];
  keywordTags: string[];
  searchQuery: string;
  /** The Archive view; never on together with Trash. */
  showArchivedOnly: boolean;
  showFavoritesOnly: boolean;
  showTrashOnly: boolean;
  styleFilters: VisualStyle[];
  /** A tag picked in the sidebar, lowercased; empty for none. */
  tagFilter: string;
  timeFilter: TimeFilter | null;
}

export interface CardsSearchQueryArgs {
  createdAtRange?: TimeFilter["range"];
  favoritesOnly?: boolean;
  hexFilters?: string[];
  hueFilters?: ColorHueBucket[];
  searchQuery?: string;
  showArchivedOnly?: boolean;
  showTrashOnly?: boolean;
  /** Only set for oldest first, so the default query keeps its key. */
  sort?: "oldest";
  styleFilters?: VisualStyle[];
  tag?: string;
  types?: CardType[];
}

export interface UseCardsSearchControllerOptions {
  /** A folder view: every read is limited to this folder's cards. */
  folderId?: Id<"folders">;
  /** The search to start with, usually read from the page URL. */
  initialUrlState?: SearchUrlState;
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
  queryArgs: CardsSearchQueryArgs;
  resetKey: string;
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
  setSort: (sort: CardListSort) => void;
  setTimeFilter: (timeFilter: TimeFilter | null) => void;
  showArchivedOnly: boolean;
  showFavoritesOnly: boolean;
  showTrashOnly: boolean;
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

export function createInitialCardsSearchState(): CardsSearchState {
  return {
    searchQuery: "",
    keywordTags: [],
    filterTags: [],
    styleFilters: [],
    hueFilters: [],
    hexFilters: [],
    showArchivedOnly: false,
    showFavoritesOnly: false,
    showTrashOnly: false,
    tagFilter: "",
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
    showArchivedOnly: state.showArchivedOnly || undefined,
    styleFilters:
      state.styleFilters.length > 0 ? state.styleFilters : undefined,
    hueFilters: state.hueFilters.length > 0 ? state.hueFilters : undefined,
    hexFilters: state.hexFilters.length > 0 ? state.hexFilters : undefined,
    createdAtRange: state.timeFilter?.range,
    tag: state.tagFilter || undefined,
  };
}

function getHasActiveSearch(state: CardsSearchState): boolean {
  return Boolean(
    buildCardsSearchTerms(state) ||
      state.filterTags.length > 0 ||
      state.styleFilters.length > 0 ||
      state.hueFilters.length > 0 ||
      state.hexFilters.length > 0 ||
      state.showFavoritesOnly ||
      state.showTrashOnly ||
      state.showArchivedOnly ||
      state.tagFilter ||
      state.timeFilter
  );
}

function getHasNoFilters(state: CardsSearchState): boolean {
  return (
    state.keywordTags.length === 0 &&
    state.filterTags.length === 0 &&
    state.styleFilters.length === 0 &&
    state.hueFilters.length === 0 &&
    state.hexFilters.length === 0 &&
    !state.showFavoritesOnly &&
    !state.showTrashOnly &&
    !state.showArchivedOnly &&
    !state.tagFilter &&
    !state.searchQuery &&
    !state.timeFilter
  );
}

export function buildCardsSearchResetKey(state: CardsSearchState): string {
  const searchTerms = buildCardsSearchTerms(state);
  return `${searchTerms}::${state.filterTags.join(",")}::${state.styleFilters.join(",")}::${state.hueFilters.join(",")}::${state.hexFilters.join(",")}::${state.showFavoritesOnly}::${state.showTrashOnly}::${state.showArchivedOnly}::${state.tagFilter}::${state.timeFilter?.range.start ?? ""}-${state.timeFilter?.range.end ?? ""}`;
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
      showArchivedOnly: false,
      searchQuery: "",
    };
  }

  if (quickCommand === "archive") {
    return {
      ...state,
      showArchivedOnly: !state.showArchivedOnly,
      showTrashOnly: false,
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

  if (state.showArchivedOnly) {
    return {
      ...state,
      showArchivedOnly: false,
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

  if (state.tagFilter) {
    return {
      ...state,
      tagFilter: "",
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
    initialUrlState,
    onNavigateView,
    view,
    folderId,
  } = options;
  const [storedSearchState, setSearchState] = useState<CardsSearchState>(
    () => ({
      ...createInitialCardsSearchState(),
      filterTags: initialUrlState?.types ?? [],
      searchQuery: initialUrlState?.q ?? "",
      tagFilter: initialUrlState?.tag ?? "",
    })
  );
  // In a routed view the route owns the favorites, archive and trash flags;
  // the stored state keeps them off, so Backspace never clears a view.
  const searchState = useMemo<CardsSearchState>(
    () =>
      view === undefined
        ? storedSearchState
        : { ...storedSearchState, ...libraryViewFlags(view) },
    [storedSearchState, view]
  );
  const [sort, setSort] = useState<CardListSort>(
    initialUrlState?.sort ?? "newest"
  );
  const [remoteCards, setRemoteCardsState] = useState<Doc<"cards">[]>([]);
  const [localCards, setLocalCards] = useState<Doc<"cards">[]>([]);
  const lastRemoteResultRef = useRef<{
    ids: ReadonlySet<string>;
    key: string;
  } | null>(null);

  const setRemoteCards = useCallback(
    (cards: Doc<"cards">[] | undefined, remoteQueryKey?: string) => {
      const nextCards = cards ?? [];
      setRemoteCardsState(nextCards);

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
    searchState.searchQuery
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

  // Clearing the input (or turning it into a chip on Enter) applies at once.
  const remoteSearchQuery = isSearchQueryEmpty
    ? searchState.searchQuery
    : debouncedSearchQuery;

  const queryArgs = useMemo(
    () => ({
      ...buildCardsSearchQueryArgs({
        ...searchState,
        searchQuery: remoteSearchQuery,
      }),
      ...(sort === "oldest" ? { sort: "oldest" as const } : {}),
      ...(folderId ? { folderId } : {}),
    }),
    [folderId, remoteSearchQuery, searchState, sort]
  );

  const remoteSearchTerms = queryArgs.searchQuery ?? "";
  const urlState = useMemo<SearchUrlState>(
    () => ({
      q: remoteSearchTerms,
      sort,
      tag: searchState.tagFilter,
      types: searchState.filterTags,
    }),
    [remoteSearchTerms, searchState.filterTags, searchState.tagFilter, sort]
  );

  const hasActiveSearch = useMemo(
    () => getHasActiveSearch(searchState),
    [searchState]
  );

  // Instant local hits come from every card this screen has seen, so a
  // folder view keeps only the folder's own.
  const localSearchResults = useMemo(
    () =>
      filterLocalCards(
        folderId
          ? localCards.filter((card) =>
              (card.folderIds ?? []).includes(folderId)
            )
          : localCards,
        {
          searchTerms,
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
      ),
    [folderId, localCards, searchState, searchTerms, sort]
  );

  const remoteSearchResults = useMemo(() => {
    if (!hasActiveSearch) {
      return remoteCards;
    }
    return filterLocalCards(remoteCards, {
      searchTerms,
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
  }, [hasActiveSearch, remoteCards, searchState, searchTerms, sort]);

  // While typing pauses are pending, the previous remote results stay on
  // screen, narrowed to the current terms above, next to instant local hits.
  const isSearchPending = remoteSearchQuery !== searchState.searchQuery;

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
    () => `${buildCardsSearchResetKey(searchState)}::${sort}`,
    [searchState, sort]
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
        // Already showing this search (as chips or typed text): keep it as is.
        const sameTerms =
          keepSearch || buildCardsSearchTerms(prev) === state.q.trim();
        const sameTypes =
          prev.filterTags.length === state.types.length &&
          prev.filterTags.every((type) => state.types.includes(type));
        const tag = state.tag ?? "";
        if (sameTerms && sameTypes && prev.tagFilter === tag) {
          return prev;
        }
        return {
          ...prev,
          ...(sameTerms ? {} : { keywordTags: [], searchQuery: state.q }),
          filterTags: sameTypes ? prev.filterTags : state.types,
          tagFilter: tag,
        };
      });
      setSort(state.sort);
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
      tagFilter: searchState.tagFilter,
      onRemoveTagFilter: () =>
        setSearchState((prev) => ({
          ...prev,
          tagFilter: "",
        })),
      onClearAll: clearAllFilters,
      sort,
      onSortChange: setSort,
    }),
    [clearAllFilters, onKeyDown, onSearchChange, searchState, sort]
  );

  return {
    searchQuery: searchState.searchQuery,
    keywordTags: searchState.keywordTags,
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
    applyUrlState,
    clearAllFilters,
    searchBarProps,
    setSort,
    sort,
    updateCachedCard,
    urlState,
  };
}
