export const MAX_FOLDERS_PER_USER = 500;
export const MAX_FOLDERS_PER_CARD = 50;
/** Longest folder name, in characters, after trimming. */
export const MAX_FOLDER_NAME_LENGTH = 300;
export const MAX_FOLDER_CARD_IDS = 100;
/** Longest smart folder search, in characters, as stored (canonical). */
export const MAX_SMART_FOLDER_QUERY_LENGTH = 500;

/** "manual" folders hold the cards put in them; "smart" ones save a search. */
export type FolderKind = "manual" | "smart";

export const FOLDER_COLORS = [
  "gray",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;

export type FolderColor = (typeof FOLDER_COLORS)[number];

export const isFolderColor = (value: unknown): value is FolderColor =>
  typeof value === "string" &&
  (FOLDER_COLORS as readonly string[]).includes(value);

export const FOLDER_ERROR_MESSAGES = {
  DUPLICATE_NAME: "A folder with this name already exists",
  EMPTY_NAME: "Name the folder",
  NAME_TOO_LONG: `Folder names can be at most ${MAX_FOLDER_NAME_LENGTH} characters`,
  TOO_MANY_FOLDERS: `You can have up to ${MAX_FOLDERS_PER_USER} folders`,
  TOO_MANY_FOLDERS_ON_CARD: `A card can be in up to ${MAX_FOLDERS_PER_CARD} folders`,
  NOT_FOUND: "Folder not found",
  EMPTY_QUERY: "Add a search for the smart folder",
  QUERY_TOO_LONG: `Smart folder searches can be at most ${MAX_SMART_FOLDER_QUERY_LENGTH} characters`,
  SMART_FOLDER_IN_QUERY:
    "A smart folder's search can't use another smart folder",
  SMART_FOLDER_MEMBERSHIP:
    "Cards can't be added to a smart folder; it shows the cards that match its search",
  QUERY_ON_MANUAL_FOLDER: "Only smart folders have a search",
  SMART_FOLDER_TRASH:
    "Smart folders don't show Trash. To search for the word, put it in quotes",
} as const;

/** The name as stored: trimmed, with inner whitespace runs kept. */
export const normalizeFolderName = (name: string): string => name.trim();

/** The key that makes names unique per account, ignoring case. */
export const folderNameKey = (name: string): string =>
  normalizeFolderName(name).toLowerCase();

/**
 * Why a folder name is refused, or null when it is fine. Counts characters
 * (code points), so emoji and CJK names get the full length.
 */
export const explainInvalidFolderName = (name: string): string | null => {
  const normalized = normalizeFolderName(name);
  if (!normalized) {
    return FOLDER_ERROR_MESSAGES.EMPTY_NAME;
  }
  if (Array.from(normalized).length > MAX_FOLDER_NAME_LENGTH) {
    return FOLDER_ERROR_MESSAGES.NAME_TOO_LONG;
  }
  return null;
};

/**
 * Why a smart folder's search is refused before any folder lookups, or
 * null when it is fine. `canonical` is the search as parseSearchQuery
 * writes it, which is what gets stored.
 */
export const explainInvalidSmartFolderQuery = (
  canonical: string
): string | null => {
  if (!canonical.trim()) {
    return FOLDER_ERROR_MESSAGES.EMPTY_QUERY;
  }
  if (Array.from(canonical).length > MAX_SMART_FOLDER_QUERY_LENGTH) {
    return FOLDER_ERROR_MESSAGES.QUERY_TOO_LONG;
  }
  return null;
};
