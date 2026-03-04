export const SEARCH_DEFAULT_CARD_LIMIT = 100;
export const SEARCH_LOCAL_SEARCH_CACHE_LIMIT = 1000;

export const SEARCH_TOKEN_SEPARATOR = /\s+/;
export const SEARCH_TOKEN_TRIM_PATTERN =
  /^[,.;:!?()[\]{}"']+|[,.;:!?()[\]{}"']+$/g;

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
