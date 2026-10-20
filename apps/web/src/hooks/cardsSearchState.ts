import type { Id } from "@teak/convex/_generated/dataModel";
import {
  classifySearchToken,
  formatSearchQualifier,
  parseSearchQuery,
  parseTimeSearchQuery,
  quoteSearchValue,
  randomShuffleSeed,
  resolveQuickSearchCommand,
  type TimeFilter,
} from "@teak/convex/shared";
import type {
  CardType,
  ColorHueBucket,
  VisualStyle,
} from "@teak/convex/shared/constants";
import { type LibraryView, libraryViewFlags } from "../lib/libraryViews";
import {
  isSeededSort,
  type LibrarySort,
  queryOrder,
  type SearchUrlState,
} from "../lib/searchUrlState";
import { semanticSearchText } from "./useSemanticSearch";

export interface CardsSearchState {
  filterTags: CardType[];
  hexFilters: string[];
  hueFilters: ColorHueBucket[];
  keywordTags: string[];
  qualifierChips: string[];
  searchQuery: string;
  showArchivedOnly: boolean;
  showFavoritesOnly: boolean;
  showTrashOnly: boolean;
  styleFilters: VisualStyle[];
  tagFilter: string;
  timeFilter: TimeFilter | null;
}

export type CardsVisualFilters = Pick<
  CardsSearchState,
  "hexFilters" | "hueFilters" | "styleFilters" | "timeFilter"
>;

export interface CardsSearchQueryArgs {
  createdAtRange?: TimeFilter["range"];
  favoritesOnly?: boolean;
  folderId?: Id<"folders">;
  folderQuery?: string;
  hexFilters?: string[];
  hueFilters?: ColorHueBucket[];
  searchQuery?: string;
  showArchivedOnly?: boolean;
  showTrashOnly?: boolean;
  shuffleSeed?: number;
  sort?: "oldest" | "relevance" | "shuffle";
  styleFilters?: VisualStyle[];
  tag?: string;
  types?: CardType[];
}

export function createInitialCardsSearchState(): CardsSearchState {
  return {
    searchQuery: "",
    keywordTags: [],
    qualifierChips: [],
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
    ...state.qualifierChips,
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

export function getHasActiveSearch(state: CardsSearchState): boolean {
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

export function getHasNoFilters(state: CardsSearchState): boolean {
  return (
    state.keywordTags.length === 0 &&
    state.qualifierChips.length === 0 &&
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

const phraseChips = (phrases: readonly string[]) =>
  Array.from(
    new Set(phrases.map((phrase) => quoteSearchValue(phrase.toLowerCase())))
  );

export function qualifierChipsFromText(text: string): string[] {
  return parseSearchQuery(text).qualifiers.map(formatSearchQualifier);
}

export const addChips = (current: string[], additions: string[]) => {
  const next = [...current];
  for (const chip of additions) {
    if (!next.includes(chip)) {
      next.push(chip);
    }
  }
  return next.length === current.length ? current : next;
};

export function cardsSearchStateFromQuery(
  query: string
): Pick<CardsSearchState, "keywordTags" | "qualifierChips" | "searchQuery"> {
  const parsed = parseSearchQuery(query);
  return {
    keywordTags: phraseChips(parsed.phrases),
    qualifierChips: parsed.qualifiers.map(formatSearchQualifier),
    searchQuery: parsed.terms.join(" "),
  };
}

export function isSameSearch(left: string, right: string): boolean {
  return (
    parseSearchQuery(left).canonical.toLowerCase() ===
    parseSearchQuery(right).canonical.toLowerCase()
  );
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
  const parsed = parseSearchQuery(state.searchQuery);
  const qualifierAdditions = parsed.qualifiers.map(formatSearchQualifier);
  const keywordAdditions: string[] = phraseChips(parsed.phrases).filter(
    (phrase) => !state.keywordTags.includes(phrase)
  );

  for (const token of parsed.terms) {
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
        ? addChips(state.keywordTags, keywordAdditions)
        : state.keywordTags,
    qualifierChips: addChips(state.qualifierChips, qualifierAdditions),
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

  if (state.qualifierChips.length > 0) {
    return {
      ...state,
      qualifierChips: state.qualifierChips.slice(0, -1),
    };
  }

  return state;
}

export interface CardsOrder {
  seed?: number;
  sort: LibrarySort;
}

export const nextShuffleSeed = (previous?: number): number => {
  const seed = randomShuffleSeed();
  return seed === previous ? (seed + 1) % 2 ** 31 : seed;
};

export const orderFromUrl = (
  state: Pick<SearchUrlState, "seed" | "sort"> | undefined,
  previous?: CardsOrder
): CardsOrder => {
  const sort = state?.sort ?? "newest";
  if (!isSeededSort(sort)) {
    return { sort };
  }
  const seed =
    state?.seed ??
    (previous && isSeededSort(previous.sort) ? previous.seed : undefined) ??
    nextShuffleSeed();
  return { seed, sort };
};

export const orderQueryArgs = (
  order: CardsOrder
): Pick<CardsSearchQueryArgs, "shuffleSeed" | "sort"> => {
  const { shuffleSeed, sort } = queryOrder(order);
  if (sort === "shuffle") {
    return { shuffleSeed, sort };
  }
  if (sort === "oldest" || sort === "relevance") {
    return { sort };
  }
  return {};
};

export const effectiveCardsOrder = (
  order: CardsOrder,
  canSortByRelevance: boolean,
  sortPicked: boolean
): CardsOrder => {
  if (order.sort === "relevance" && !canSortByRelevance) {
    return { sort: "newest" };
  }
  if (order.sort === "newest" && canSortByRelevance && !sortPicked) {
    return { sort: "relevance" };
  }
  return order;
};

export const initialCardsSearchState = (
  urlState: SearchUrlState | undefined
): CardsSearchState => ({
  ...createInitialCardsSearchState(),
  ...cardsSearchStateFromQuery(urlState?.q ?? ""),
  filterTags: urlState?.types ?? [],
  tagFilter: urlState?.tag ?? "",
});

export function initialCardsSearchQueryArgs(
  view: LibraryView,
  urlState?: SearchUrlState
): CardsSearchQueryArgs | null {
  if (urlState && isSeededSort(urlState.sort) && urlState.seed === undefined) {
    return null;
  }
  return {
    ...buildCardsSearchQueryArgs({
      ...initialCardsSearchState(urlState),
      ...libraryViewFlags(view),
    }),
    ...orderQueryArgs(
      effectiveCardsOrder(
        orderFromUrl(urlState),
        semanticSearchText(urlState?.q ?? "") !== "",
        false
      )
    ),
  };
}
