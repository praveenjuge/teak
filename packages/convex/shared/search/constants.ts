export const SEARCH_DEFAULT_CARD_LIMIT = 100;
export const SEARCH_LOCAL_SEARCH_CACHE_LIMIT = 1000;

/**
 * Hard caps for server-side card search/listing.
 *
 * These bound how much work an authenticated caller can force per request:
 * search-index reads, in-memory sorting, URL signing, and (for visual
 * filters) the number of concurrent facet queries fanned out via Promise.all.
 */
export const SEARCH_DEFAULT_LIMIT = 50;
export const SEARCH_MAX_CARD_LIMIT = 200;
export const SEARCH_MAX_PAGE_SIZE = 100;
export const SEARCH_MAX_OFFSET = 1000;
export const SEARCH_MAX_VISUAL_FILTERS_PER_DIMENSION = 24;

/**
 * Clamp a caller-provided `limit` to `[1, SEARCH_MAX_CARD_LIMIT]`.
 * Non-finite or missing values fall back to `fallback`.
 */
export function clampSearchLimit(
  limit: number | undefined,
  fallback = SEARCH_DEFAULT_LIMIT
): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return fallback;
  }
  const floored = Math.floor(limit);
  if (floored < 1) {
    return 1;
  }
  return Math.min(floored, SEARCH_MAX_CARD_LIMIT);
}

/**
 * Clamp a pagination page size (`paginationOpts.numItems`) to
 * `[1, SEARCH_MAX_PAGE_SIZE]`. Non-finite values fall back to 1.
 */
export function clampPageSize(numItems: number): number {
  if (!Number.isFinite(numItems)) {
    return 1;
  }
  const floored = Math.floor(numItems);
  if (floored < 1) {
    return 1;
  }
  return Math.min(floored, SEARCH_MAX_PAGE_SIZE);
}

/**
 * Clamp a derived offset cursor to `[0, SEARCH_MAX_OFFSET]`. Negative or
 * non-finite cursors collapse to 0 so deep/garbage cursors cannot inflate the
 * underlying `.take()` size.
 */
export function clampSearchOffset(offset: number): number {
  if (!Number.isFinite(offset) || offset < 0) {
    return 0;
  }
  return Math.min(Math.floor(offset), SEARCH_MAX_OFFSET);
}

export const SEARCH_TOKEN_SEPARATOR = /\s+/;
export const SEARCH_TOKEN_TRIM_CHARACTERS = `,.;:!?()[]{}"'`;

const FAVORITES_SEARCH_COMMANDS = new Set([
  "fav",
  "favs",
  "favorites",
  "favourite",
  "favourites",
]);

const TRASH_SEARCH_COMMANDS = new Set([
  "trash",
  "deleted",
  "bin",
  "recycle",
  "trashed",
]);

export type SearchQuickCommand = "favorites" | "trash" | null;

export function resolveQuickSearchCommand(query: string): SearchQuickCommand {
  const normalizedQuery = query.toLowerCase().trim();
  if (FAVORITES_SEARCH_COMMANDS.has(normalizedQuery)) {
    return "favorites";
  }

  if (TRASH_SEARCH_COMMANDS.has(normalizedQuery)) {
    return "trash";
  }

  return null;
}
