import { type CardListSort, normalizeCardListSort } from "@teak/convex/shared";
import { type CardType, isCardType } from "@teak/convex/shared/constants";

/**
 * The search a library URL carries: `?q=`, `?sort=oldest`, the card types
 * picked in the sidebar as `?type=link,image`, and a sidebar tag as
 * `?tag=design`.
 */
export interface SearchUrlState {
  q: string;
  sort: CardListSort;
  /** A tag, lowercased like the tag list; empty or missing for none. */
  tag?: string;
  types: CardType[];
}

/**
 * Longest tag the URL keeps. A tag has at most 64 characters, but some
 * letters grow when lowercased (a capital İ becomes two), so the lowercased
 * name the tag list uses can be longer.
 */
const MAX_URL_TAG_LENGTH = 256;

/** A tag from the URL as the tag list names it: trimmed and lowercased. */
export function parseTagParam(value: string | null): string {
  return (value ?? "").trim().toLowerCase().slice(0, MAX_URL_TAG_LENGTH);
}

// Long enough for any real search; keeps a pasted URL from filling the input
// (and every query key) with an arbitrarily long string.
export const MAX_URL_SEARCH_LENGTH = 500;

interface ReadableParams {
  get: (name: string) => string | null;
}

export const EMPTY_SEARCH_URL_STATE: SearchUrlState = {
  q: "",
  sort: "newest",
  tag: "",
  types: [],
};

/** Known card types from `?type=`, once each, in the order given. */
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

/** Reads the search from a URL. Unknown or malformed values fall back. */
export function parseSearchUrlState(params: ReadableParams): SearchUrlState {
  return {
    q: (params.get("q") ?? "").trim().slice(0, MAX_URL_SEARCH_LENGTH),
    sort: normalizeCardListSort(params.get("sort")),
    tag: parseTagParam(params.get("tag")),
    types: parseCardTypesParam(params.get("type")),
  };
}

/**
 * Writes the search into a copy of `params` and returns the query string.
 * Defaults are left out (`newest`, an empty search), and every other
 * parameter, such as `card`, is kept as it was.
 */
export function serializeSearchUrlState(
  state: SearchUrlState,
  params: URLSearchParams | string = ""
): string {
  const next = new URLSearchParams(params);
  const q = state.q.trim().slice(0, MAX_URL_SEARCH_LENGTH);
  if (q) {
    next.set("q", q);
  } else {
    next.delete("q");
  }
  if (state.sort === "oldest") {
    next.set("sort", "oldest");
  } else {
    next.delete("sort");
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
  // Commas are valid in a query; keep `?type=link,image` readable.
  return next.toString().replace(/%2C/g, ",");
}

const sameTypes = (left: CardType[], right: CardType[]): boolean =>
  left.length === right.length && left.every((type) => right.includes(type));

export const isSameSearchUrlState = (
  left: SearchUrlState,
  right: SearchUrlState
): boolean =>
  left.q.trim() === right.q.trim() &&
  normalizeCardListSort(left.sort) === normalizeCardListSort(right.sort) &&
  parseTagParam(left.tag ?? null) === parseTagParam(right.tag ?? null) &&
  sameTypes(left.types, right.types);

/** The same search with `type` switched on or off, for a sidebar type link. */
export const toggleSearchUrlType = (
  state: SearchUrlState,
  type: CardType
): SearchUrlState => ({
  ...state,
  types: state.types.includes(type)
    ? state.types.filter((active) => active !== type)
    : [...state.types, type],
});
