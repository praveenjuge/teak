import { isSameSearchUrlState, type SearchUrlState } from "./searchUrlState";

export interface SearchUrlChange {
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
    return { sortChanged: false, tagChanged: false, typesChanged: false };
  }
  return {
    sortChanged:
      previous.sort !== next.sort ||
      (previous.seed !== undefined && previous.seed !== next.seed),
    tagChanged: (previous.tag ?? "") !== (next.tag ?? ""),
    typesChanged:
      previous.types.length !== next.types.length ||
      previous.types.some((type) => !next.types.includes(type)),
  };
}

const fromUrl = (
  previous: SearchUrlState | null,
  state: SearchUrlState
): SearchFromUrl => ({
  keepSearch: previous !== null && previous.q.trim() === state.q.trim(),
  state,
});

export function createSearchUrlSync(initial?: SearchUrlState) {
  let read: SearchUrlState | null = initial ?? null;
  let synced: SearchUrlState | null = initial ?? null;
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
    searchSettled(state: SearchUrlState): SearchUrlChange | null {
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
