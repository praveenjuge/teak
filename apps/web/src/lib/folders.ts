import type { api } from "@teak/convex";
import {
  combineSearchQueries,
  describePriceBound,
  formatSearchQualifier,
  hostForDisplay,
  parsePriceBound,
  parseSearchQuery,
} from "@teak/convex/shared";
import type { CardType } from "@teak/convex/shared/constants";
import {
  explainInvalidFolderName,
  FOLDER_ERROR_MESSAGES,
  type FolderColor,
  folderNameKey,
  MAX_FOLDER_NAME_LENGTH,
  MAX_FOLDERS_PER_USER,
} from "@teak/convex/shared/folders";
import type { TeakTranslator } from "@teak/i18n";
import type { FunctionReturnType } from "convex/server";

export type FoldersTranslator = TeakTranslator<"lib.folders">;

export type FolderSummary = FunctionReturnType<
  typeof api.folders.listFolders
>[number];

export const manualFolders = <T extends Pick<FolderSummary, "kind">>(
  folders: readonly T[]
): T[] => folders.filter((folder) => folder.kind !== "smart");

/**
 * The input's maxLength. Browsers count UTF-16 units, so an emoji uses two;
 * twice the limit lets 300 emoji through, and the name check (which counts
 * characters, like the server) refuses anything longer.
 */
export const FOLDER_NAME_INPUT_MAX_LENGTH = MAX_FOLDER_NAME_LENGTH * 2;

export const FOLDER_DOT_CLASSES: Record<FolderColor, string> = {
  gray: "bg-zinc-400",
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-400",
  green: "bg-emerald-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
};

export const FOLDER_ICON_CLASSES: Record<FolderColor, string> = {
  gray: "text-zinc-500 fill-zinc-500/15",
  red: "text-red-500 fill-red-500/15",
  orange: "text-orange-500 fill-orange-500/15",
  amber: "text-amber-500 fill-amber-500/15",
  green: "text-emerald-500 fill-emerald-500/15",
  teal: "text-teal-500 fill-teal-500/15",
  blue: "text-blue-500 fill-blue-500/15",
  violet: "text-violet-500 fill-violet-500/15",
  pink: "text-pink-500 fill-pink-500/15",
};

export const folderColorLabel = (color: FolderColor, t: FoldersTranslator) =>
  t(`colors.${color}`);

export const CARD_DRAG_TYPE = "application/x-teak-card";

export const isCardDrag = (dataTransfer: DataTransfer | null): boolean =>
  Boolean(
    dataTransfer && Array.from(dataTransfer.types).includes(CARD_DRAG_TYPE)
  );

export const folderPath = (folderId: string) =>
  `/f/${encodeURIComponent(folderId)}`;

export const folderIdForPath = (
  pathname: string | null | undefined
): string | null => {
  const match = /^\/f\/([^/]+)\/?$/.exec(pathname ?? "");
  return match ? decodeFolderSegment(match[1]) : null;
};

export const decodeFolderSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

export const filterFolders = (
  folders: readonly FolderSummary[],
  query: string
): FolderSummary[] => {
  const needle = query.trim().toLowerCase();
  return needle
    ? folders.filter((folder) => folder.name.toLowerCase().includes(needle))
    : [...folders];
};

export const hasFolderNamed = (
  folders: readonly FolderSummary[],
  name: string,
  exceptId?: string
) => {
  const key = folderNameKey(name);
  return folders.some(
    (folder) => folder._id !== exceptId && folderNameKey(folder.name) === key
  );
};

/**
 * Why `name` can't be saved as a folder's name, in the server's words
 * (translate it with `errors.byEnglishMessage`), or null. A rename passes
 * the folder's id: it doesn't count against the folder limit or clash with
 * its own name. Until `folders` loads, only the name itself is checked.
 */
export const folderNameProblem = (
  folders: readonly FolderSummary[] | undefined,
  name: string,
  renamingId?: string
): string | null => {
  if (
    folders &&
    renamingId === undefined &&
    folders.length >= MAX_FOLDERS_PER_USER
  ) {
    return FOLDER_ERROR_MESSAGES.TOO_MANY_FOLDERS;
  }
  if (folders && hasFolderNamed(folders, name, renamingId)) {
    return FOLDER_ERROR_MESSAGES.DUPLICATE_NAME;
  }
  return name.trim() ? explainInvalidFolderName(name) : null;
};

/**
 * What a folder picker offers for the name typed into its search: to create
 * it, or why it can't (the folder limit). Nothing for no name yet, a name a
 * folder already has, or one the server refuses.
 */
export const newFolderOption = (
  folders: readonly FolderSummary[] | undefined,
  name: string
): "create" | "limit" | null => {
  if (
    !(folders && name.trim()) ||
    hasFolderNamed(folders, name) ||
    explainInvalidFolderName(name) !== null
  ) {
    return null;
  }
  return folders.length >= MAX_FOLDERS_PER_USER ? "limit" : "create";
};

export interface SmartFolderSearchContext {
  folder?: Pick<FolderSummary, "kind" | "name" | "query"> | null;
  tag?: string;
  terms: string;
  types?: readonly CardType[];
  view?: "all" | "favorites" | "archive" | "trash";
}

export const buildSmartFolderQuery = ({
  folder,
  tag,
  terms,
  types = [],
  view = "all",
}: SmartFolderSearchContext): string | null => {
  if (view === "trash") {
    return null;
  }
  const extra = [
    ...(folder && folder.kind !== "smart"
      ? [formatSearchQualifier({ key: "folder", value: folder.name })]
      : []),
    ...(view === "favorites" ? ["is:fav"] : []),
    ...(view === "archive" ? ["is:archived"] : []),
    ...types.map((type) => formatSearchQualifier({ key: "type", value: type })),
    ...(tag ? [formatSearchQualifier({ key: "tag", value: tag })] : []),
    terms,
  ].join(" ");
  if (folder?.kind === "smart") {
    const added = parseSearchQuery(extra).canonical;
    if (!added) {
      return null;
    }
    return combineSearchQueries(folder.query ?? "", extra);
  }
  return parseSearchQuery(extra).canonical || null;
};

const capitalize = (text: string) =>
  text ? `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}` : text;

export const suggestSmartFolderName = (
  query: string,
  t: FoldersTranslator
): string => {
  const parsed = parseSearchQuery(query);
  const parts = [
    ...parsed.qualifiers.map((qualifier) => {
      switch (qualifier.key) {
        case "type":
          return t("suggestedName.type", { type: qualifier.value });
        case "site":
          return hostForDisplay(qualifier.value);
        case "is":
          return qualifier.value === "fav"
            ? t("suggestedName.favorites")
            : t("suggestedName.archived");
        case "price": {
          const bound = parsePriceBound(qualifier.value);
          return bound
            ? t("suggestedName.price", {
                bound: describePriceBound(bound).toLowerCase(),
              })
            : "";
        }
        case "text":
          return t("suggestedName.text", { text: qualifier.value });
        default:
          return qualifier.value;
      }
    }),
    ...parsed.phrases.map((phrase) => `“${phrase}”`),
    ...(parsed.terms.length > 0 ? [parsed.terms.join(" ")] : []),
  ];
  const name = capitalize(parts.join(" · ").trim());
  return Array.from(name).slice(0, MAX_FOLDER_NAME_LENGTH).join("");
};
