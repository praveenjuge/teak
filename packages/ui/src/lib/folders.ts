import type { Id } from "@teak/convex/_generated/dataModel";
import {
  combineSearchQueries,
  formatSearchQualifier,
  hostForDisplay,
  parseSearchQuery,
} from "@teak/convex/shared";
import { CARD_TYPE_LABELS, type CardType } from "@teak/convex/shared/constants";
import {
  type FolderColor,
  type FolderKind,
  MAX_FOLDER_NAME_LENGTH,
} from "@teak/convex/shared/folders";
import { ConvexError } from "convex/values";

/** A folder as `api.folders.listFolders` returns it. */
export interface FolderSummary {
  _id: Id<"folders">;
  /** Cards in a manual folder that are neither archived nor in Trash. */
  activeCardCount: number;
  color?: FolderColor;
  createdAt: number;
  kind: FolderKind;
  name: string;
  /** A smart folder's search, written the canonical way. */
  query?: string;
  updatedAt: number;
}

/** Folders cards can be put in: smart folders show a search instead. */
export const manualFolders = <T extends Pick<FolderSummary, "kind">>(
  folders: readonly T[]
): T[] => folders.filter((folder) => folder.kind !== "smart");

export {
  FOLDER_COLORS,
  type FolderColor,
} from "@teak/convex/shared/folders";

/**
 * The input's maxLength. Browsers count UTF-16 units, so an emoji uses two;
 * twice the limit lets 300 emoji through, and the name check (which counts
 * characters, like the server) refuses anything longer.
 */
export const FOLDER_NAME_INPUT_MAX_LENGTH = MAX_FOLDER_NAME_LENGTH * 2;

/** The dot color for each palette color; no color is a quiet outline. */
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

/** Folder icon tints, so folders read at a glance even in the icon rail. */
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

export const FOLDER_COLOR_LABELS: Record<FolderColor, string> = {
  gray: "Gray",
  red: "Red",
  orange: "Orange",
  amber: "Amber",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  violet: "Violet",
  pink: "Pink",
};

/** The drag data a card carries, so a sidebar folder can take it. */
export const CARD_DRAG_TYPE = "application/x-teak-card";

/** Whether a drag carries a card (its ID is only readable on drop). */
export const isCardDrag = (dataTransfer: DataTransfer | null): boolean =>
  Boolean(
    dataTransfer && Array.from(dataTransfer.types).includes(CARD_DRAG_TYPE)
  );

export const folderPath = (folderId: string) =>
  `/f/${encodeURIComponent(folderId)}`;

/** The folder id a pathname shows (`/f/:id`), or null outside a folder. */
export const folderIdForPath = (
  pathname: string | null | undefined
): string | null => {
  const match = /^\/f\/([^/]+)\/?$/.exec(pathname ?? "");
  return match ? decodeFolderSegment(match[1]) : null;
};

/**
 * A folder ID from its address segment. A mangled escape (`/f/%E0`) is kept
 * as typed instead of throwing; no folder has that ID, so the page shows
 * Folder not found.
 */
export const decodeFolderSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** Folders whose name contains the query, ignoring case. */
export const filterFolders = (
  folders: readonly FolderSummary[],
  query: string
): FolderSummary[] => {
  const needle = query.trim().toLowerCase();
  return needle
    ? folders.filter((folder) => folder.name.toLowerCase().includes(needle))
    : [...folders];
};

/** Whether a folder already has this name, ignoring case and spaces. */
export const hasFolderNamed = (
  folders: readonly FolderSummary[],
  name: string,
  exceptId?: string
) => {
  const key = name.trim().toLowerCase();
  return folders.some(
    (folder) => folder._id !== exceptId && folder.name.toLowerCase() === key
  );
};

/** The message a folder mutation failed with, for a toast or inline error. */
export const folderErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof ConvexError) {
    const message = (error.data as { message?: unknown } | undefined)?.message;
    if (typeof message === "string") {
      return message;
    }
  }
  return fallback;
};

/** What the screen shows besides the search box, for saving it. */
export interface SmartFolderSearchContext {
  folder?: Pick<FolderSummary, "kind" | "name" | "query"> | null;
  /** The sidebar tag (`?tag=`). */
  tag?: string;
  /** The search box's chips and text, as the server reads them. */
  terms: string;
  types?: readonly CardType[];
  view?: "all" | "favorites" | "archive" | "trash";
}

/**
 * The search a smart folder would save for what is on screen: the words
 * and chips, the card types, the sidebar tag, the Favorites or Archive
 * view, and the folder being viewed (a manual one as `folder:`, a smart
 * one's own search). Null when there is nothing to save: Trash, an empty
 * search, or a smart folder with nothing added to its search.
 */
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

/**
 * A readable name for a smart folder from its search, such as
 * "Design · Links · github.com" for `tag:design type:link site:github.com`,
 * clipped to the name limit.
 */
export const suggestSmartFolderName = (query: string): string => {
  const parsed = parseSearchQuery(query);
  const parts = [
    ...parsed.qualifiers.map((qualifier) => {
      switch (qualifier.key) {
        case "type":
          return `${CARD_TYPE_LABELS[qualifier.value]}s`;
        case "site":
          return hostForDisplay(qualifier.value);
        case "is":
          return qualifier.value === "fav" ? "Favorites" : "Archived";
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
