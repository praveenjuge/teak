import type { LibraryView } from "./libraryViews";

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
      { keys: ["E"], label: "Archive or unarchive" },
      { keys: ["Delete"], label: "Move to Trash" },
      { keys: ["X"], label: "Select or deselect" },
      { keys: ["Esc"], label: "Clear the selection" },
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
      `[${NEW_NOTE_COMPOSER_ATTRIBUTE}] [contenteditable='true']`
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
