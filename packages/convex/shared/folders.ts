// Folder limits and colors, shared by the backend, the public API and the
// apps so they agree on what the server accepts.

/** Most folders one account can have. */
export const MAX_FOLDERS_PER_USER = 500;
/** Most folders one card can be in. */
export const MAX_FOLDERS_PER_CARD = 50;
/** Longest folder name, in characters, after trimming. */
export const MAX_FOLDER_NAME_LENGTH = 300;
/** Most cards one add, remove or move call may name. */
export const MAX_FOLDER_CARD_IDS = 100;

/** The small fixed palette a folder can be colored with. */
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
