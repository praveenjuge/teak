import { codePointLength } from "./utils/codePoints";

export const MAX_FOLDERS_PER_USER = 500;
export const MAX_FOLDERS_PER_CARD = 50;
export const MAX_FOLDER_NAME_LENGTH = 300;
export const MAX_FOLDER_CARD_IDS = 100;
export const MAX_SMART_FOLDER_QUERY_LENGTH = 500;
export const MAX_FOLDER_RULES = 50;
export const MAX_FOLDER_AUTO_TAGS = 10;
/** How long a rule run's changes are kept, so it can be undone. */
export const FOLDER_RULE_RUN_UNDO_MS = 24 * 60 * 60 * 1000;

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
  RULES_ON_SMART_FOLDER: "Only manual folders have rules",
  TOO_MANY_RULES: `You can have rules on up to ${MAX_FOLDER_RULES} folders`,
  TOO_MANY_AUTO_TAGS: `A folder can add up to ${MAX_FOLDER_AUTO_TAGS} tags`,
  EMPTY_RULE_QUERY: "Add a search for the cards to file",
  RULE_QUERY_SIMILARITY:
    "Folder rules can't use like: or mood:. Search by words, tags, type or site instead",
  RULE_RUN_NOT_FOUND: "Rule run not found",
  RULE_RUN_EXPIRED: "This rule run can no longer be undone",
} as const;

export const normalizeFolderName = (name: string): string => name.trim();

export const folderNameKey = (name: string): string =>
  normalizeFolderName(name).toLowerCase();

export const explainInvalidFolderName = (name: string): string | null => {
  const normalized = normalizeFolderName(name);
  if (!normalized) {
    return FOLDER_ERROR_MESSAGES.EMPTY_NAME;
  }
  if (codePointLength(normalized) > MAX_FOLDER_NAME_LENGTH) {
    return FOLDER_ERROR_MESSAGES.NAME_TOO_LONG;
  }
  return null;
};

export const explainInvalidSmartFolderQuery = (
  canonical: string
): string | null => {
  if (!canonical.trim()) {
    return FOLDER_ERROR_MESSAGES.EMPTY_QUERY;
  }
  if (codePointLength(canonical) > MAX_SMART_FOLDER_QUERY_LENGTH) {
    return FOLDER_ERROR_MESSAGES.QUERY_TOO_LONG;
  }
  return null;
};
