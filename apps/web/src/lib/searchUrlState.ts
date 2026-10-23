import {
  type CardListSort,
  formatSearchQualifier,
  normalizeCardListSort,
  normalizeHexColor,
  parseSearchQuery,
  parseShuffleSeed,
  parseTimeSearchQuery,
  quoteSearchValue,
  type TimeFilter,
} from "@teak/convex/shared";
import {
  type CardType,
  COLOR_HUE_BUCKETS,
  type ColorHueBucket,
  isCardType,
  isVisualStyle,
  type VisualStyle,
} from "@teak/convex/shared/constants";

export type LibrarySort = CardListSort | "revisit";

export const isSeededSort = (sort: LibrarySort): boolean =>
  sort === "shuffle" || sort === "revisit";

export const queryOrder = (state: {
  seed?: number;
  sort: LibrarySort;
}): { shuffleSeed?: number; sort: CardListSort } =>
  isSeededSort(state.sort)
    ? {
        ...(state.seed === undefined ? {} : { shuffleSeed: state.seed }),
        sort: "shuffle",
      }
    : { sort: normalizeCardListSort(state.sort) };

export interface SearchUrlState {
  /**
   * The time filter's label (`date=This Week`), read again on load, so a
   * relative date keeps meaning the current week, month or day.
   */
  date?: string;
  /** Hex colors, written without `#` in `color=`. */
  hexes?: string[];
  /** Hue names, written in `color=` before any hex colors. */
  hues?: ColorHueBucket[];
  q: string;
  seed?: number;
  sort: LibrarySort;
  /**
   * Newest was picked over a search's default Best match, so the URL names
   * it (`sort=newest`) and a reload keeps it.
   */
  sortPicked?: boolean;
  styles?: VisualStyle[];
  tag?: string;
  types: CardType[];
}

/**
 * Longest tag the URL keeps. A tag has at most 64 characters, but some
 * letters grow when lowercased (a capital İ becomes two), so the lowercased
 * name the tag list uses can be longer.
 */
const MAX_URL_TAG_LENGTH = 256;

export function parseTagParam(value: string | null): string {
  return (value ?? "").trim().toLowerCase().slice(0, MAX_URL_TAG_LENGTH);
}

/**
 * Longest search the URL keeps, and so the search box takes: the backend's
 * semantic search reads at most this many characters
 * (`VECTOR_QUERY_MAX_CHARS`), and a smart folder's search is capped the same.
 */
export const MAX_URL_SEARCH_LENGTH = 500;

/** Longest `style=`, `color=` or `date=` value the URL reads. */
const MAX_URL_FILTER_LENGTH = 256;
const MAX_URL_HEX_COLORS = 16;
const HEX_COLOR_PATTERN = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const urlSearchText = (q: string): string =>
  q.trim().slice(0, MAX_URL_SEARCH_LENGTH).trimEnd();

interface ReadableParams {
  get: (name: string) => string | null;
}

export const EMPTY_SEARCH_URL_STATE: SearchUrlState = {
  q: "",
  sort: "newest",
  tag: "",
  types: [],
};

export function parseCardTypesParam(value: string | null): CardType[] {
  const types: CardType[] = [];
  for (const part of (value ?? "").split(",")) {
    const type = part.trim().toLowerCase();
    if (isCardType(type) && !types.includes(type)) {
      types.push(type);
    }
  }
  return types;
}

const listParts = (value: string | null | undefined): string[] =>
  (value ?? "")
    .slice(0, MAX_URL_FILTER_LENGTH)
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

export function parseStylesParam(value: string | null): VisualStyle[] {
  const styles: VisualStyle[] = [];
  for (const part of listParts(value)) {
    if (isVisualStyle(part) && !styles.includes(part)) {
      styles.push(part);
    }
  }
  return styles;
}

const isHue = (value: string): value is ColorHueBucket =>
  (COLOR_HUE_BUCKETS as readonly string[]).includes(value);

export function parseColorParam(value: string | null): {
  hexes: string[];
  hues: ColorHueBucket[];
} {
  const hues: ColorHueBucket[] = [];
  const hexes: string[] = [];
  for (const part of listParts(value)) {
    if (isHue(part)) {
      if (!hues.includes(part)) {
        hues.push(part);
      }
      continue;
    }
    const hex = HEX_COLOR_PATTERN.test(part) ? normalizeHexColor(part) : null;
    if (hex && !hexes.includes(hex) && hexes.length < MAX_URL_HEX_COLORS) {
      hexes.push(hex);
    }
  }
  return { hexes, hues };
}

/**
 * Reads a `date=` label back into a time filter. A range's label joins its
 * ends with an en dash, which the time parser reads as "to".
 */
export function timeFilterFromUrl(
  date: string | undefined,
  options: { now?: Date; weekStart?: 0 | 1 } = {}
): TimeFilter | null {
  const label = (date ?? "").trim().slice(0, MAX_URL_FILTER_LENGTH);
  return label
    ? parseTimeSearchQuery(label.replace(/\s+–\s+/g, " to "), options)
    : null;
}

export function parseDateParam(value: string | null): string {
  const date = (value ?? "").trim().slice(0, MAX_URL_FILTER_LENGTH);
  // The label the page shows, so `date=2026-01-05` and the `Jan 5, 2026`
  // the page writes back read as the same search.
  return timeFilterFromUrl(date)?.label ?? "";
}

export const parseLibrarySort = (value: string | null): LibrarySort =>
  value === "revisit" ? value : normalizeCardListSort(value);

export function parseSearchUrlState(params: ReadableParams): SearchUrlState {
  const sort = parseLibrarySort(params.get("sort"));
  const seed = isSeededSort(sort)
    ? parseShuffleSeed(params.get("seed"))
    : undefined;
  const { hexes, hues } = parseColorParam(params.get("color"));
  const styles = parseStylesParam(params.get("style"));
  const date = parseDateParam(params.get("date"));
  return {
    q: urlSearchText(params.get("q") ?? ""),
    ...(seed === undefined ? {} : { seed }),
    sort,
    ...(params.get("sort") === "newest" ? { sortPicked: true } : {}),
    tag: parseTagParam(params.get("tag")),
    types: parseCardTypesParam(params.get("type")),
    ...(styles.length > 0 ? { styles } : {}),
    ...(hues.length > 0 ? { hues } : {}),
    ...(hexes.length > 0 ? { hexes } : {}),
    ...(date ? { date } : {}),
  };
}

const shuffleSeedOf = (state: SearchUrlState): number | undefined =>
  isSeededSort(parseLibrarySort(state.sort)) ? state.seed : undefined;

const pickedNewest = (state: SearchUrlState): boolean =>
  state.sortPicked === true && parseLibrarySort(state.sort) === "newest";

export function serializeSearchUrlState(
  state: SearchUrlState,
  params: URLSearchParams | string = ""
): string {
  const next = new URLSearchParams(params);
  const q = urlSearchText(state.q);
  if (q) {
    next.set("q", q);
  } else {
    next.delete("q");
  }
  if (
    state.sort === "oldest" ||
    state.sort === "shuffle" ||
    state.sort === "revisit"
  ) {
    next.set("sort", state.sort);
  } else if (pickedNewest(state)) {
    next.set("sort", "newest");
  } else {
    next.delete("sort");
  }
  const seed = shuffleSeedOf(state);
  if (seed === undefined) {
    next.delete("seed");
  } else {
    next.set("seed", String(seed));
  }
  if (state.types.length > 0) {
    next.set("type", state.types.join(","));
  } else {
    next.delete("type");
  }
  const tag = parseTagParam(state.tag ?? null);
  if (tag) {
    next.set("tag", tag);
  } else {
    next.delete("tag");
  }
  setList(next, "style", parseStylesParam((state.styles ?? []).join(",")));
  const colors = parseColorParam(
    [...(state.hues ?? []), ...(state.hexes ?? [])].join(",")
  );
  setList(next, "color", [
    ...colors.hues,
    ...colors.hexes.map((hex) => hex.slice(1).toLowerCase()),
  ]);
  const date = parseDateParam(state.date ?? null);
  if (date) {
    next.set("date", date);
  } else {
    next.delete("date");
  }
  return next.toString().replace(/%2C/g, ",");
}

function setList(params: URLSearchParams, name: string, values: string[]) {
  if (values.length > 0) {
    params.set(name, values.join(","));
  } else {
    params.delete(name);
  }
}

export const sameMembers = <T>(
  left: readonly T[] = [],
  right: readonly T[] = []
): boolean =>
  left.length === right.length && left.every((item) => right.includes(item));

/**
 * The search a URL state asks for, as the page compares it: the search text
 * as the URL keeps it (trimmed and cut to its limit), with any `type:`
 * qualifier moved into the types. The search box turns a `type:` qualifier
 * into the View menu's type filter, so `?q=type:image` and `?type=image` are
 * the same search, and so are a typed search and the shorter one the URL
 * echoes back.
 */
export function comparableSearch(state: SearchUrlState): {
  q: string;
  types: CardType[];
} {
  const q = urlSearchText(state.q);
  const parsed = parseSearchQuery(q);
  if (parsed.types.length === 0) {
    return { q, types: state.types };
  }
  const types = [...state.types];
  for (const type of parsed.types) {
    if (!types.includes(type)) {
      types.push(type);
    }
  }
  return {
    q: [
      ...parsed.qualifiers
        .filter((qualifier) => qualifier.key !== "type")
        .map(formatSearchQualifier),
      ...parsed.phrases.map(quoteSearchValue),
      ...parsed.terms,
    ].join(" "),
    types,
  };
}

const sameDate = (left?: string, right?: string): boolean =>
  (left ?? "").trim().toLowerCase() === (right ?? "").trim().toLowerCase();

/** Whether two states differ in their colors, styles or date. */
export const sameVisualFilters = (
  left: SearchUrlState,
  right: SearchUrlState
): boolean =>
  sameMembers(left.styles, right.styles) &&
  sameMembers(left.hues, right.hues) &&
  sameMembers(left.hexes, right.hexes) &&
  sameDate(left.date, right.date);

export const isSameSearchUrlState = (
  left: SearchUrlState,
  right: SearchUrlState
): boolean => {
  const leftSearch = comparableSearch(left);
  const rightSearch = comparableSearch(right);
  return (
    leftSearch.q === rightSearch.q &&
    parseLibrarySort(left.sort) === parseLibrarySort(right.sort) &&
    pickedNewest(left) === pickedNewest(right) &&
    shuffleSeedOf(left) === shuffleSeedOf(right) &&
    parseTagParam(left.tag ?? null) === parseTagParam(right.tag ?? null) &&
    sameMembers(leftSearch.types, rightSearch.types) &&
    sameVisualFilters(left, right)
  );
};
