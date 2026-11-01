import type {
  BulkBarAction,
  BulkBarView,
} from "../components/selection/BulkActionBar";
import type { GridDirection } from "./gridNavigation";
import { cardMenuShortcuts, type MenuShortcut } from "./keyboardShortcuts";

export interface GridKeyContext {
  addToFolder: boolean;
  allSelectedFavorited: boolean;
  hasSelection: boolean;
  isSelectionMode: boolean;
  view: BulkBarView;
}

export type GridCardKeyAction =
  | "addTags"
  | "archive"
  | "delete"
  | "deleteForever"
  | "favorite"
  | "select";

export type GridKeyAction =
  | { type: "move"; direction: GridDirection }
  | { type: "selection"; action: BulkBarAction }
  | { type: "card"; action: GridCardKeyAction }
  | { type: "cancelSelection" }
  | { type: "blocked" };

const DIRECTIONS: Record<string, GridDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  j: "next",
  k: "previous",
};

const isDeleteKey = (key: string) => key === "Delete" || key === "Backspace";

export function gridKeyAction(
  key: string,
  context: GridKeyContext
): GridKeyAction | null {
  const direction = DIRECTIONS[key];
  if (direction) {
    return { type: "move", direction };
  }
  const { addToFolder, hasSelection, view } = context;
  const inTrash = view === "trash";
  const isActionKey =
    key === "f" || key === "t" || key === "e" || isDeleteKey(key);
  if (isActionKey && addToFolder) {
    return { type: "blocked" };
  }
  if (isActionKey && hasSelection && inTrash) {
    return isDeleteKey(key)
      ? { type: "selection", action: "deleteForever" }
      : { type: "blocked" };
  }
  if (isActionKey && hasSelection) {
    if (key === "f") {
      return {
        type: "selection",
        action: context.allSelectedFavorited ? "unfavorite" : "favorite",
      };
    }
    if (key === "e") {
      return {
        type: "selection",
        action: view === "archive" ? "unarchive" : "archive",
      };
    }
    if (key === "t") {
      return { type: "selection", action: "addTags" };
    }
    return { type: "selection", action: "delete" };
  }
  if (isDeleteKey(key)) {
    return { type: "card", action: inTrash ? "deleteForever" : "delete" };
  }
  if (isActionKey && inTrash) {
    return null;
  }
  if (key === "f") {
    return { type: "card", action: "favorite" };
  }
  if (key === "t") {
    return { type: "card", action: "addTags" };
  }
  if (key === "e") {
    return { type: "card", action: "archive" };
  }
  if (key === "x") {
    return { type: "card", action: "select" };
  }
  if (key === "Escape" && context.isSelectionMode) {
    return { type: "cancelSelection" };
  }
  return null;
}

/** ⌘A on a Mac, Ctrl+A elsewhere: in selection mode it picks every card. */
export function isSelectAllKey(
  event: Pick<
    globalThis.KeyboardEvent,
    "altKey" | "ctrlKey" | "key" | "metaKey" | "repeat" | "shiftKey"
  >
): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !(event.altKey || event.shiftKey || event.repeat) &&
    event.key.toLowerCase() === "a"
  );
}

type CardShortcuts = ReturnType<typeof cardMenuShortcuts>;
type KeyedShortcut = Exclude<keyof CardShortcuts, "copy">;

const SHORTCUT_KEYS: Record<KeyedShortcut, string> = {
  addTags: "t",
  archive: "e",
  delete: "Delete",
  favorite: "f",
  select: "x",
};

export function focusedCardShortcuts(
  isSelectionMode: boolean,
  apple?: boolean
): Partial<CardShortcuts> {
  const all = cardMenuShortcuts(apple);
  const context: GridKeyContext = {
    addToFolder: false,
    allSelectedFavorited: false,
    hasSelection: isSelectionMode,
    isSelectionMode,
    view: "library",
  };
  const shortcuts: Partial<CardShortcuts> = { copy: all.copy };
  for (const name of Object.keys(SHORTCUT_KEYS) as KeyedShortcut[]) {
    if (gridKeyAction(SHORTCUT_KEYS[name], context)?.type === "card") {
      shortcuts[name] = all[name];
    }
  }
  return shortcuts;
}

export function selectionShortcut(
  action: BulkBarAction,
  context: Pick<
    GridKeyContext,
    "addToFolder" | "allSelectedFavorited" | "view"
  >,
  apple?: boolean
): MenuShortcut | undefined {
  const all = cardMenuShortcuts(apple);
  const selected = { ...context, hasSelection: true, isSelectionMode: true };
  for (const name of Object.keys(SHORTCUT_KEYS) as KeyedShortcut[]) {
    const result = gridKeyAction(SHORTCUT_KEYS[name], selected);
    if (result?.type === "selection" && result.action === action) {
      return all[name];
    }
  }
}
