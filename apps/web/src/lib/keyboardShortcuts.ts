import {
  createTeakTranslator,
  englishMessages,
  type TeakTranslator,
} from "@teak/i18n";
import type { LibraryView } from "./libraryViews";
import { isApplePlatform } from "./platform";

type ShortcutsTranslator = TeakTranslator<"shortcuts">;
type ShortcutGroupId = keyof (typeof englishMessages)["shortcuts"]["groups"];
type ShortcutRowId = keyof (typeof englishMessages)["shortcuts"]["rows"];

const englishShortcuts = createTeakTranslator(
  "en",
  englishMessages,
  "shortcuts"
);

export interface ShortcutRow {
  combo?: boolean;
  /** Stable id of a row in the shortcuts list. */
  id?: ShortcutRowId;
  keys: string[];
  label: string;
  sequence?: boolean;
  /** Text typed in the search box rather than keys pressed. */
  syntax?: boolean;
}

export interface ShortcutGroup {
  id: ShortcutGroupId;
  rows: ShortcutRow[];
  title: string;
}

type ShortcutRowDefinition = Omit<ShortcutRow, "id" | "label"> & {
  id: ShortcutRowId;
};

export const GO_TO_VIEW_KEYS: Record<LibraryView, string> = {
  all: "e",
  favorites: "f",
  archive: "a",
  trash: "t",
};

// Keys and search syntax stay as typed; titles and labels are translated.
const SHORTCUT_GROUPS: {
  id: ShortcutGroupId;
  rows: ShortcutRowDefinition[];
}[] = [
  {
    id: "cards",
    rows: [
      { id: "moveBetweenCards", keys: ["←", "↑", "→", "↓"] },
      { id: "nextOrPreviousCard", keys: ["J", "K"] },
      { id: "openCard", keys: ["Enter"] },
      { id: "favorite", keys: ["F"] },
      { id: "addTags", keys: ["T"] },
      { id: "archive", keys: ["E"] },
      { id: "moveToTrash", keys: ["Delete"] },
      { id: "select", keys: ["X"] },
      { id: "copy", keys: ["Mod", "C"], combo: true },
      { id: "clearSelection", keys: ["Esc"] },
    ],
  },
  {
    id: "openCard",
    rows: [
      { id: "previousOrNextCard", keys: ["←", "→"] },
      { id: "favorite", keys: ["F"] },
      { id: "addTag", keys: ["T"] },
      { id: "writeNote", keys: ["N"] },
      { id: "focusNote", keys: ["Mod", "E"], combo: true },
      { id: "openOrDownload", keys: ["O"] },
      { id: "openLink", keys: ["Mod", "Enter"], combo: true },
      { id: "markLinkDone", keys: ["D"] },
      { id: "copyLinkOrText", keys: ["C"] },
      { id: "toggleDetails", keys: ["I"] },
      { id: "readOrPreview", keys: ["R"] },
      { id: "archive", keys: ["E"] },
      { id: "moveToTrash", keys: ["Delete"] },
    ],
  },
  {
    id: "goTo",
    rows: [
      { id: "goToEverything", keys: ["G", "E"], sequence: true },
      { id: "goToFavorites", keys: ["G", "F"], sequence: true },
      { id: "goToArchive", keys: ["G", "A"], sequence: true },
      { id: "goToTrash", keys: ["G", "T"], sequence: true },
    ],
  },
  {
    id: "search",
    rows: [
      { id: "excludeWord", keys: ["-word"], syntax: true },
      { id: "excludeFilter", keys: ["-tag:x"], syntax: true },
      { id: "eitherOne", keys: ["a OR b"], syntax: true },
      { id: "group", keys: ["( … )"], syntax: true },
      { id: "exactWords", keys: ['"phrase"'], syntax: true },
    ],
  },
  {
    id: "anywhere",
    rows: [
      { id: "commandPalette", keys: ["Mod", "K"], combo: true },
      { id: "search", keys: ["/"] },
      { id: "newNote", keys: ["N"] },
      { id: "uploadFiles", keys: ["U"] },
      { id: "notifications", keys: ["Alt", "T"], combo: true },
      { id: "keyboardShortcuts", keys: ["?"] },
    ],
  },
];

/** The shortcuts list, titled and labelled in the translator's language. */
export const keyboardShortcutGroups = (
  t: ShortcutsTranslator = englishShortcuts
): ShortcutGroup[] =>
  SHORTCUT_GROUPS.map((group) => ({
    id: group.id,
    title: t(`groups.${group.id}`),
    rows: group.rows.map((row) => ({ ...row, label: t(`rows.${row.id}`) })),
  }));

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

/**
 * Whether a key press belongs to IME composition (Japanese, Chinese,
 * Korean): its Enter confirms the text and is not a submit. Safari sends that
 * Enter with `isComposing` false but `keyCode` 229.
 */
export const isImeComposing = (event: {
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean };
}): boolean => event.nativeEvent?.isComposing === true || event.keyCode === 229;
