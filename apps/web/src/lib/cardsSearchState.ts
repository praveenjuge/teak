import type { Id } from "@teak/convex/_generated/dataModel";
import {
  classifySearchToken,
  combineSearchQueries,
  formatSearchQualifier,
  parseSearchQuery,
  parseTimeSearchQuery,
  quoteSearchValue,
  randomShuffleSeed,
  resolveQuickSearchCommand,
  type SearchExpression,
  searchExpressionParts,
  semanticRequestFor,
  type TimeFilter,
} from "@teak/convex/shared";
import type {
  CardType,
  ColorHueBucket,
  VisualStyle,
} from "@teak/convex/shared/constants";
import { type LibraryView, libraryViewFlags } from "./libraryViews";
import {
  comparableSearch,
  isSeededSort,
  type LibrarySort,
  queryOrder,
  type SearchUrlState,
  timeFilterFromUrl,
} from "./searchUrlState";

/** The text a search sends to semantic search, or "" when it sends none. */
export const semanticSearchText = (
  searchQuery: string,
  folderQuery?: string
): string => {
  const combined =
    folderQuery === undefined
      ? searchQuery
      : combineSearchQueries(folderQuery, searchQuery);
  return combined === null
    ? ""
    : (semanticRequestFor(parseSearchQuery(combined))?.cacheText ?? "");
};

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

const TYPED_OR = /(^|[\s(])OR(?=[\s)]|$)/;

export function buildCardsSearchTerms(state: CardsSearchState): string {
  const typed = state.searchQuery.trim();
  const hasPills =
    state.qualifierChips.length > 0 || state.keywordTags.length > 0;
  // A space binds tighter than OR, so typed text with an OR beside the pills
  // is grouped, the way Enter keeps it apart from them: `a OR b`, and a
  // leading `OR b`, which has no left side in the box.
  const grouped = hasPills && TYPED_OR.test(typed) ? `(${typed})` : typed;
  return [
    ...state.qualifierChips,
    ...state.keywordTags,
    ...(grouped ? [grouped] : []),
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

const isExcludedQualifier = (expression: SearchExpression | undefined) =>
  expression?.op === "not" && expression.item.op === "qualifier";

/**
 * The operators of a query as pills: an excluded filter (`-tag:old`) joins
 * the filter pills, and an excluded word or an OR group joins the words.
 */
const expressionChips = (parsed: ReturnType<typeof parseSearchQuery>) => {
  const qualifierChips: string[] = [];
  const keywordTags: string[] = [];
  for (const part of searchExpressionParts(parsed)) {
    if (isExcludedQualifier(parseSearchQuery(part).expression)) {
      qualifierChips.push(part);
    } else {
      keywordTags.push(part);
    }
  }
  return { keywordTags, qualifierChips };
};

export function qualifierChipsFromText(text: string): string[] {
  const parsed = parseSearchQuery(text);
  return [
    ...parsed.qualifiers.map(formatSearchQualifier),
    ...expressionChips(parsed).qualifierChips,
  ];
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

/**
 * A `type:` qualifier becomes the View menu's type filter instead of a chip of
 * its own, so the menu shows it checked and every type picked either way
 * matches any of them.
 */
export function withTypeQualifiersAsFilters(
  state: CardsSearchState
): CardsSearchState {
  const types: CardType[] = [];
  const qualifierChips = state.qualifierChips.filter((chip) => {
    const [qualifier] = parseSearchQuery(chip).qualifiers;
    if (qualifier?.key !== "type") {
      return true;
    }
    types.push(qualifier.value);
    return false;
  });
  if (types.length === 0) {
    return state;
  }
  const filterTags = [...state.filterTags];
  for (const type of types) {
    if (!filterTags.includes(type)) {
      filterTags.push(type);
    }
  }
  return { ...state, filterTags, qualifierChips };
}

/** The colors, styles and date a URL names, as search state. */
export function visualFiltersFromUrl(
  urlState: SearchUrlState | undefined,
  options: { now?: Date; weekStart?: 0 | 1 } = {}
): CardsVisualFilters {
  return {
    hexFilters: urlState?.hexes ?? [],
    hueFilters: urlState?.hues ?? [],
    styleFilters: urlState?.styles ?? [],
    timeFilter: timeFilterFromUrl(urlState?.date, options),
  };
}

export function cardsSearchStateFromQuery(
  query: string
): Pick<CardsSearchState, "keywordTags" | "qualifierChips" | "searchQuery"> {
  const parsed = parseSearchQuery(query);
  const operators = expressionChips(parsed);
  return {
    keywordTags: [...phraseChips(parsed.phrases), ...operators.keywordTags],
    qualifierChips: [
      ...parsed.qualifiers.map(formatSearchQualifier),
      ...operators.qualifierChips,
    ],
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
  const operators = expressionChips(parsed);
  const qualifierAdditions = [
    ...parsed.qualifiers.map(formatSearchQualifier),
    ...operators.qualifierChips,
  ];
  const keywordAdditions: string[] = [
    ...phraseChips(parsed.phrases),
    ...operators.keywordTags,
  ].filter((phrase) => !state.keywordTags.includes(phrase));

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

/**
 * Backspace in an empty search box removes the chip just left of the cursor:
 * the last one the search bar shows. The search bar lays its chips out in
 * this order, read backwards here. Favorites, Archive and Trash show no chip,
 * so they go only after every chip.
 */
const BACKSPACE_ORDER: ((
  state: CardsSearchState
) => CardsSearchState | null)[] = [
  (state) =>
    state.hexFilters.length > 0
      ? { ...state, hexFilters: state.hexFilters.slice(0, -1) }
      : null,
  (state) =>
    state.hueFilters.length > 0
      ? { ...state, hueFilters: state.hueFilters.slice(0, -1) }
      : null,
  (state) =>
    state.styleFilters.length > 0
      ? { ...state, styleFilters: state.styleFilters.slice(0, -1) }
      : null,
  (state) =>
    state.filterTags.length > 0
      ? { ...state, filterTags: state.filterTags.slice(0, -1) }
      : null,
  (state) => (state.timeFilter ? { ...state, timeFilter: null } : null),
  (state) =>
    state.keywordTags.length > 0
      ? { ...state, keywordTags: state.keywordTags.slice(0, -1) }
      : null,
  (state) =>
    state.qualifierChips.length > 0
      ? { ...state, qualifierChips: state.qualifierChips.slice(0, -1) }
      : null,
  (state) => (state.tagFilter ? { ...state, tagFilter: "" } : null),
  (state) => (state.showTrashOnly ? { ...state, showTrashOnly: false } : null),
  (state) =>
    state.showArchivedOnly ? { ...state, showArchivedOnly: false } : null,
  (state) =>
    state.showFavoritesOnly ? { ...state, showFavoritesOnly: false } : null,
];

export function applyBackspaceToCardsSearchState(
  state: CardsSearchState
): CardsSearchState {
  if (state.searchQuery !== "" || getHasNoFilters(state)) {
    return state;
  }
  for (const remove of BACKSPACE_ORDER) {
    const next = remove(state);
    if (next) {
      return next;
    }
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
  urlState: SearchUrlState | undefined,
  options: { now?: Date; weekStart?: 0 | 1 } = {}
): CardsSearchState => {
  const search = urlState ? comparableSearch(urlState) : undefined;
  return {
    ...createInitialCardsSearchState(),
    ...cardsSearchStateFromQuery(search?.q ?? ""),
    ...visualFiltersFromUrl(urlState, options),
    filterTags: search?.types ?? [],
    tagFilter: urlState?.tag ?? "",
  };
};

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
        urlState?.sortPicked === true
      )
    ),
  };
}
