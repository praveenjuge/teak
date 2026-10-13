import type { Id } from "@teak/convex/_generated/dataModel";
import type { FolderColor } from "@teak/convex/shared/folders";
import { ConvexError } from "convex/values";

/** A folder as `api.folders.listFolders` returns it. */
export interface FolderSummary {
  _id: Id<"folders">;
  /** Cards in the folder that are neither archived nor in Trash. */
  activeCardCount: number;
  color?: FolderColor;
  createdAt: number;
  kind: "manual" | "smart";
  name: string;
  updatedAt: number;
}

export {
  FOLDER_COLORS,
  type FolderColor,
} from "@teak/convex/shared/folders";

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

/** The app path of a folder's view. */
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
