import type { LibraryView } from "./libraryViews";
import { isApplePlatform } from "./platform";

export interface ShortcutRow {
  /** Keys pressed together (Alt+T) rather than alternatives. */
  combo?: boolean;
  /** Keycaps as shown, such as `["G", "F"]`. */
  keys: string[];
  label: string;
  /** `then` for a sequence (G then F); otherwise the keys are alternatives. */
  sequence?: boolean;
}

export interface ShortcutGroup {
  rows: ShortcutRow[];
  title: string;
}

/** `g` sequences that open a library view. */
export const GO_TO_VIEW_KEYS: Record<LibraryView, string> = {
  all: "e",
  favorites: "f",
  archive: "a",
  trash: "t",
};

/** Every shortcut, as the shortcuts dialog and the docs list them. */
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
      { keys: ["/"], label: "Search" },
      { keys: ["N"], label: "New note" },
      { keys: ["U"], label: "Upload files" },
      { keys: ["Alt", "T"], label: "Go to notifications (Undo)", combo: true },
      { keys: ["?"], label: "Keyboard shortcuts" },
    ],
  },
];

/**
 * A key as this platform's keyboard labels it: `Mod` is ⌘ on Apple platforms
 * and Ctrl elsewhere; Alt, Shift and Enter are ⌥, ⇧ and ↩ on a Mac.
 */
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

/**
 * Keys pressed together as `aria-keyshortcuts` names them, such as
 * `Meta+Shift+S` for Mod Shift S on a Mac.
 */
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

/** Cmd+Enter (Ctrl+Enter) saves the note being written. */
export const SAVE_NOTE_KEYS = ["Mod", "Enter"] as const;
/** Cmd+E (Ctrl+E) opens the note being written full screen. */
export const FULL_SCREEN_NOTE_KEYS = ["Mod", "E"] as const;

/** A key shown beside a menu item whose action the key also does. */
export interface MenuShortcut {
  /** For `aria-keyshortcuts`, such as `Meta+C`. */
  keys: string;
  /** As the menu shows it, such as `⌘C`. */
  label: string;
}

/**
 * The keys menus show for card actions, as the grid and the open card
 * take them: Cmd on Apple platforms and Ctrl elsewhere, and the Mac's
 * Delete key (⌫, which the browser calls Backspace) on a Mac.
 */
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

/** Marks the library's search box, which `/` focuses. */
export const LIBRARY_SEARCH_ATTRIBUTE = "data-library-search";
/** Marks the new-note composer, which `N` focuses. */
export const NEW_NOTE_COMPOSER_ATTRIBUTE = "data-new-note-composer";
/** Marks the Upload files button, which `U` presses. */
export const UPLOAD_FILES_ATTRIBUTE = "data-upload-files";

const visible = (element: HTMLElement) => element.getClientRects().length > 0;

/** Focuses the search box on the page; false when there is none. */
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

/** Focuses the new-note composer on the page; false when there is none. */
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

// The sidebar's New menu keeps Upload files inside a closed menu, so it
// registers what Upload files does instead of leaving a button to press.
let uploadFilesHandler: (() => boolean) | null = null;

/** Makes `U` run `handler` while no Upload files button is on the page. */
export function registerUploadFiles(handler: () => boolean): () => void {
  uploadFilesHandler = handler;
  return () => {
    if (uploadFilesHandler === handler) {
      uploadFilesHandler = null;
    }
  };
}

/** Presses the Upload files button; false when there is none to press. */
export function pressUploadFiles(): boolean {
  const button = Array.from(
    document.querySelectorAll<HTMLButtonElement>(`[${UPLOAD_FILES_ATTRIBUTE}]`)
  ).find((candidate) => visible(candidate) && !candidate.disabled);
  if (button) {
    button.click();
    return true;
  }
  return uploadFilesHandler?.() ?? false;
}

// `N` away from the composer opens Everything first; the composer then
// takes focus when it mounts, if that is soon enough to be this request.
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
