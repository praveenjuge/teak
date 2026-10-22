import {
  comparableSearch,
  isSameSearchUrlState,
  type SearchUrlState,
  sameMembers,
  sameVisualFilters,
} from "./searchUrlState";

export interface SearchUrlChange {
  /** Colors, styles or the date changed. */
  filtersChanged: boolean;
  sortChanged: boolean;
  tagChanged: boolean;
  typesChanged: boolean;
}

export interface SearchFromUrl {
  keepSearch: boolean;
  state: SearchUrlState;
}

export function searchUrlChange(
  previous: SearchUrlState | null,
  next: SearchUrlState
): SearchUrlChange {
  if (previous === null) {
    return {
      filtersChanged: false,
      sortChanged: false,
      tagChanged: false,
      typesChanged: false,
    };
  }
  return {
    filtersChanged: !sameVisualFilters(previous, next),
    sortChanged:
      previous.sort !== next.sort ||
      (previous.seed !== undefined && previous.seed !== next.seed),
    tagChanged: (previous.tag ?? "") !== (next.tag ?? ""),
    typesChanged: !sameMembers(
      comparableSearch(previous).types,
      comparableSearch(next).types
    ),
  };
}

const fromUrl = (
  previous: SearchUrlState | null,
  state: SearchUrlState
): SearchFromUrl => ({
  keepSearch:
    previous !== null &&
    comparableSearch(previous).q === comparableSearch(state).q,
  state,
});

export function createSearchUrlSync(initial?: SearchUrlState) {
  let read: SearchUrlState | null = initial ?? null;
  let synced: SearchUrlState | null = initial ?? null;
  let settled: SearchUrlState | null = null;
  let replaceNext = false;
  return {
    /**
     * Effects can re-run with the same URL while the router still lags the
     * page's own write.
     */
    urlReported(state: SearchUrlState): SearchFromUrl | null {
      const lastRead = read;
      read = state;
      if (
        (lastRead && isSameSearchUrlState(lastRead, state)) ||
        (synced && isSameSearchUrlState(synced, state))
      ) {
        return null;
      }
      const previous = synced;
      synced = state;
      return fromUrl(previous, state);
    },
    /**
     * The router can deliver Back or Forward together with the page's own last
     * write and never report it, so it is read from the location directly.
     */
    historyLanded(state: SearchUrlState): SearchFromUrl | null {
      const previous = synced;
      if (previous && isSameSearchUrlState(previous, state)) {
        return null;
      }
      read = state;
      synced = state;
      return fromUrl(previous, state);
    },
    /**
     * Only a search the page has not reported yet is a change. A page Next.js
     * kept hidden reports the search it showed before, again, when it is
     * revealed on a new URL: that is the URL's search still to apply, not
     * the person's.
     */
    searchSettled(state: SearchUrlState): SearchUrlChange | null {
      const lastSettled = settled;
      settled = state;
      if (lastSettled && isSameSearchUrlState(lastSettled, state)) {
        return null;
      }
      const previous = synced;
      if (previous && isSameSearchUrlState(previous, state)) {
        return null;
      }
      synced = state;
      const change = searchUrlChange(previous, state);
      if (replaceNext) {
        replaceNext = false;
        return { ...change, sortChanged: false };
      }
      return change;
    },
    replaceNextSortChange(): void {
      replaceNext = true;
    },
  };
}
