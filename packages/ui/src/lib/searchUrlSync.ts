import { isSameSearchUrlState, type SearchUrlState } from "./searchUrlState";

/** A change worth its own history entry: a new sort or new card types. */
export interface SearchUrlChange {
  sortChanged: boolean;
  /** The sidebar tag was picked or cleared. */
  tagChanged: boolean;
  typesChanged: boolean;
}

/** A search to show, from the URL. */
export interface SearchFromUrl {
  /** Only the types and sort changed, so text still being typed stays. */
  keepSearch: boolean;
  state: SearchUrlState;
}

/** How `next` differs from `previous`, the search the URL last held. */
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

/**
 * Keeps a library page's search and its URL in step both ways, so neither
 * side's update echoes back to the other.
 */
export function createSearchUrlSync(initial?: SearchUrlState) {
  let read: SearchUrlState | null = initial ?? null;
  let synced: SearchUrlState | null = initial ?? null;
  let replaceNext = false;
  return {
    /**
     * The router reported `state`. Only a URL that differs from the last one
     * it reported, and from the search last synced, is shown: effects can
     * re-run with the same URL while it still lags the page's own write.
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
     * Back or Forward landed on `state`. The router can deliver it together
     * with the page's own last write and never report it, so it is read from
     * the location directly.
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
    /** The page's search settled on `state`; the change to write, if any. */
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
    /**
     * The next settled sort change replaces the URL instead of adding a
     * history entry: leaving Revisit from a link, or dealing a new seed.
     */
    replaceNextSortChange(): void {
      replaceNext = true;
    },
  };
}
