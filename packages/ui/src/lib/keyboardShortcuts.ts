import type { LibraryView } from "./libraryViews";
import { isApplePlatform } from "./platform";

export interface ShortcutRow {
  combo?: boolean;
  keys: string[];
  label: string;
  sequence?: boolean;
}

export interface ShortcutGroup {
  rows: ShortcutRow[];
  title: string;
}

export const GO_TO_VIEW_KEYS: Record<LibraryView, string> = {
  all: "e",
  favorites: "f",
  archive: "a",
  trash: "t",
};

export const KEYBOARD_SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Cards",
    rows: [
      { keys: ["←", "↑", "→", "↓"], label: "Move between cards" },
      { keys: ["J", "K"], label: "Next or previous card" },
      { keys: ["Enter"], label: "Open the card" },
      { keys: ["F"], label: "Favorite or unfavorite" },
      { keys: ["T"], label: "Add tags" },
      { keys: ["E"], label: "Archive or unarchive" },
      { keys: ["Delete"], label: "Move to Trash" },
      { keys: ["X"], label: "Select or deselect" },
      { keys: ["Mod", "C"], label: "Copy text, link, or image", combo: true },
      { keys: ["Esc"], label: "Clear the selection" },
    ],
  },
  {
    title: "Open card",
    rows: [
      { keys: ["←", "→"], label: "Previous or next card" },
      { keys: ["F"], label: "Favorite or unfavorite" },
      { keys: ["T"], label: "Add a tag" },
      { keys: ["N"], label: "Write a note" },
      { keys: ["Mod", "E"], label: "Focus on the note", combo: true },
      { keys: ["E"], label: "Archive or unarchive" },
      { keys: ["Delete"], label: "Move to Trash" },
    ],
  },
  {
    title: "Go to",
    rows: [
      { keys: ["G", "E"], label: "Everything", sequence: true },
      { keys: ["G", "F"], label: "Favorites", sequence: true },
      { keys: ["G", "A"], label: "Archive", sequence: true },
      { keys: ["G", "T"], label: "Trash", sequence: true },
    ],
  },
  {
    title: "Anywhere",
    rows: [
      { keys: ["Mod", "K"], label: "Command palette", combo: true },
      { keys: ["/"], label: "Search" },
      { keys: ["N"], label: "New note" },
      { keys: ["U"], label: "Upload files" },
      { keys: ["Alt", "T"], label: "Go to notifications (Undo)", combo: true },
      { keys: ["?"], label: "Keyboard shortcuts" },
    ],
  },
];

export function platformKey(key: string, apple = isApplePlatform()): string {
  if (key === "Mod") {
    return apple ? "⌘" : "Ctrl";
  }
  if (!apple) {
    return key;
  }
  return MAC_KEY_SYMBOLS[key] ?? key;
}

const MAC_KEY_SYMBOLS: Record<string, string> = {
  Alt: "⌥",
  Enter: "↩",
  Shift: "⇧",
};

const ARIA_KEY_NAMES: Record<string, string> = {
  "←": "ArrowLeft",
  "→": "ArrowRight",
  Esc: "Escape",
};

export function ariaKeyShortcut(
  keys: readonly string[],
  apple = isApplePlatform()
): string {
  return keys
    .map((key) => {
      if (key === "Mod") {
        return apple ? "Meta" : "Control";
      }
      return ARIA_KEY_NAMES[key] ?? key;
    })
    .join("+");
}

export const SAVE_NOTE_KEYS = ["Mod", "Enter"] as const;
export const FOCUS_NOTE_KEYS = ["Mod", "E"] as const;

export function isFocusNoteKey(
  event: Pick<
    KeyboardEvent,
    "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
  >,
  apple = isApplePlatform()
): boolean {
  if (event.key.toLowerCase() !== "e" || event.altKey || event.shiftKey) {
    return false;
  }
  return apple
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

export interface MenuShortcut {
  keys: string;
  label: string;
}

/** The browser calls the Mac's Delete key (⌫) Backspace. */
export function cardMenuShortcuts(apple = isApplePlatform()) {
  const letter = (key: string): MenuShortcut => ({ keys: key, label: key });
  return {
    addTags: letter("T"),
    archive: letter("E"),
    copy: apple
      ? { keys: "Meta+C", label: "⌘C" }
      : { keys: "Control+C", label: "Ctrl+C" },
    delete: apple
      ? { keys: "Backspace", label: "⌫" }
      : { keys: "Delete", label: "Del" },
    favorite: letter("F"),
    select: letter("X"),
  } satisfies Record<string, MenuShortcut>;
}

export const LIBRARY_SEARCH_ATTRIBUTE = "data-library-search";
export const NEW_NOTE_COMPOSER_ATTRIBUTE = "data-new-note-composer";

const visible = (element: HTMLElement) => element.getClientRects().length > 0;

export function focusLibrarySearch(): boolean {
  const input = Array.from(
    document.querySelectorAll<HTMLInputElement>(`[${LIBRARY_SEARCH_ATTRIBUTE}]`)
  ).find(visible);
  if (!input) {
    return false;
  }
  input.focus();
  input.select();
  return true;
}

export function focusNewNoteComposer(): boolean {
  const editor = Array.from(
    document.querySelectorAll<HTMLElement>(
      `[${NEW_NOTE_COMPOSER_ATTRIBUTE}] :is([contenteditable='true'], textarea)`
    )
  ).find(visible);
  if (!editor) {
    return false;
  }
  editor.focus();
  editor.scrollIntoView({ block: "nearest" });
  return true;
}

const uploadFilesHandlers: Array<() => boolean> = [];

export function registerUploadFiles(handler: () => boolean): () => void {
  uploadFilesHandlers.push(handler);
  return () => {
    const index = uploadFilesHandlers.lastIndexOf(handler);
    if (index >= 0) {
      uploadFilesHandlers.splice(index, 1);
    }
  };
}

export function pressUploadFiles(): boolean {
  return uploadFilesHandlers[uploadFilesHandlers.length - 1]?.() ?? false;
}

const COMPOSER_FOCUS_REQUEST_MS = 10_000;
let composerFocusRequestedAt: number | null = null;

export function requestNewNoteComposerFocus(now = Date.now()) {
  composerFocusRequestedAt = now;
}

export function isNewNoteComposerFocusRequested(now = Date.now()): boolean {
  return (
    composerFocusRequestedAt !== null &&
    now - composerFocusRequestedAt <= COMPOSER_FOCUS_REQUEST_MS
  );
}

export function clearNewNoteComposerFocusRequest() {
  composerFocusRequestedAt = null;
}
