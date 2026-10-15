export const SEARCH_DEFAULT_CARD_LIMIT = 30;
export const SEARCH_LOCAL_SEARCH_CACHE_LIMIT = 1000;

export const SEARCH_DEFAULT_LIMIT = 50;
export const SEARCH_MAX_CARD_LIMIT = 200;
export const SEARCH_MAX_PAGE_SIZE = 100;
export const SEARCH_MAX_OFFSET = 1000;
export const SEARCH_MAX_VISUAL_FILTERS_PER_DIMENSION = 24;

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

const ARCHIVE_SEARCH_COMMANDS = new Set(["archive", "archived"]);

export type SearchQuickCommand = "favorites" | "trash" | "archive" | null;

export function resolveQuickSearchCommand(query: string): SearchQuickCommand {
  const normalizedQuery = query.toLowerCase().trim();
  if (FAVORITES_SEARCH_COMMANDS.has(normalizedQuery)) {
    return "favorites";
  }

  if (TRASH_SEARCH_COMMANDS.has(normalizedQuery)) {
    return "trash";
  }

  if (ARCHIVE_SEARCH_COMMANDS.has(normalizedQuery)) {
    return "archive";
  }

  return null;
}
