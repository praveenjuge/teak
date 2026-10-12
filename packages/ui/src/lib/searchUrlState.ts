import { type CardListSort, normalizeCardListSort } from "@teak/convex/shared";

/** The search a library URL carries: `?q=` and `?sort=oldest`. */
export interface SearchUrlState {
  q: string;
  sort: CardListSort;
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
};

/** Reads the search from a URL. Unknown or malformed values fall back. */
export function parseSearchUrlState(params: ReadableParams): SearchUrlState {
  return {
    q: (params.get("q") ?? "").trim().slice(0, MAX_URL_SEARCH_LENGTH),
    sort: normalizeCardListSort(params.get("sort")),
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
  return next.toString();
}

export const isSameSearchUrlState = (
  left: SearchUrlState,
  right: SearchUrlState
): boolean =>
  left.q.trim() === right.q.trim() &&
  normalizeCardListSort(left.sort) === normalizeCardListSort(right.sort);
