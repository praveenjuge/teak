import {
  createTeakTranslator,
  englishMessages,
  type TeakTranslator,
} from "@teak/i18n";
import {
  type AppActionId,
  appActionKeys,
  GO_TO,
  GO_TO_TARGETS,
  goToKeys,
  keyName,
} from "./appCommands";
import { type CardActionId, cardActionKeyName } from "./cardActions";
import { dialogKeyName, OPEN_CARD_LINK_KEYS } from "./cardDialogKeys";
import type { GoToViewOptions, LibraryView } from "./libraryViews";
import { isApplePlatform, isModKey } from "./platform";

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

export const SAVE_NOTE_KEYS = ["Mod", "Enter"] as const;
export const FOCUS_NOTE_KEYS = ["Mod", "E"] as const;

/** Revisit's own keys, besides ← (archive), → (keep), Space and Escape. */
export const REVISIT_KEYS = { archive: "a", keep: "k", undo: "z" } as const;

const appKey = (id: AppActionId) => appActionKeys(id);

const cardKey = (id: CardActionId) => {
  const name = cardActionKeyName(id);
  return name ? [name] : [];
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
      { id: "favorite", keys: cardKey("favorite") },
      { id: "pin", keys: cardKey("pin") },
      { id: "movePinned", keys: ["Alt ←", "Alt →"] },
      { id: "addTags", keys: cardKey("addTags") },
      { id: "archive", keys: cardKey("archive") },
      { id: "moveToTrash", keys: cardKey("moveToTrash") },
      { id: "select", keys: cardKey("select") },
      { id: "copy", keys: ["Mod", "C"], combo: true },
      { id: "clearSelection", keys: ["Esc"] },
    ],
  },
  {
    id: "openCard",
    rows: [
      { id: "previousOrNextCard", keys: ["←", "→"] },
      { id: "favorite", keys: cardKey("favorite") },
      { id: "pin", keys: cardKey("pin") },
      { id: "addTag", keys: cardKey("addTags") },
      { id: "writeNote", keys: [dialogKeyName("focusNotes")] },
      { id: "focusNote", keys: [...FOCUS_NOTE_KEYS], combo: true },
      { id: "openOrDownload", keys: [dialogKeyName("open")] },
      { id: "openLink", keys: [...OPEN_CARD_LINK_KEYS], combo: true },
      { id: "markLinkDone", keys: cardKey("done") },
      { id: "copy", keys: cardKey("copy") },
      { id: "readOrPreview", keys: [dialogKeyName("toggleReader")] },
      { id: "highlightSelection", keys: [dialogKeyName("highlight")] },
      { id: "archive", keys: cardKey("archive") },
      { id: "moveToTrash", keys: cardKey("moveToTrash") },
    ],
  },
  {
    id: "revisit",
    rows: [
      {
        id: "revisitArchive",
        keys: ["←", keyName(REVISIT_KEYS.archive)],
      },
      { id: "revisitKeep", keys: ["→", keyName(REVISIT_KEYS.keep)] },
      { id: "revisitDetails", keys: ["Space"] },
      { id: "revisitUndo", keys: [keyName(REVISIT_KEYS.undo)] },
      { id: "revisitLeave", keys: ["Esc"] },
    ],
  },
  {
    id: "goTo",
    rows: GO_TO_TARGETS.map((target) => ({
      id: GO_TO[target].listRow,
      keys: goToKeys(target),
      sequence: true,
    })),
  },
  {
    id: "search",
    rows: [
      { id: "byTag", keys: ["tag:design"], syntax: true },
      { id: "byType", keys: ["type:note"], syntax: true },
      { id: "bySite", keys: ["site:github.com"], syntax: true },
      { id: "byFolder", keys: ["folder:reading"], syntax: true },
      { id: "byState", keys: ["is:fav"], syntax: true },
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
      { id: "commandPalette", keys: appKey("commandPalette"), combo: true },
      { id: "search", keys: appKey("search") },
      { id: "newNote", keys: appKey("newNote") },
      { id: "uploadFiles", keys: appKey("uploadFiles") },
      { id: "recordAudio", keys: appKey("recordAudio") },
      // Sonner's own key for its notifications.
      { id: "notifications", keys: ["Alt", "T"], combo: true },
      { id: "keyboardShortcuts", keys: appKey("keyboardShortcuts") },
    ],
  },
];

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

// The Mac's Delete key is ⌫ (the browser calls it Backspace), as the card
// menu shows it.
const MAC_KEY_SYMBOLS: Record<string, string> = {
  Alt: "⌥",
  Delete: "⌫",
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
      if (key === "Delete" && apple) {
        return "Backspace";
      }
      return ARIA_KEY_NAMES[key] ?? key;
    })
    .join("+");
}

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
  return isModKey(event, apple);
}

export const SHORTCUTS_DIALOG_ATTRIBUTE = "data-keyboard-shortcuts-dialog";

export const CARD_DIALOG_ATTRIBUTE = "data-card-dialog";

const TYPING_ROLES = new Set([
  "combobox",
  "searchbox",
  "spinbutton",
  "textbox",
]);

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (target.closest("[contenteditable]:not([contenteditable='false'])")) {
    return true;
  }
  const role = target.getAttribute("role");
  return role !== null && TYPING_ROLES.has(role);
}

/** Anything open over the page that takes keys: a dialog, a menu, a list. */
export const OPEN_OVERLAYS = [
  "[role='dialog'][data-state='open']",
  "[role='alertdialog'][data-state='open']",
  "[role='menu'][data-state='open']",
  "[role='listbox'][data-state='open']",
] as const;

/** An open overlay, the shortcuts list aside: shortcuts work over that. */
export const OVERLAY_SELECTOR = OPEN_OVERLAYS.map(
  (selector) => `${selector}:not([${SHORTCUTS_DIALOG_ATTRIBUTE}])`
).join(", ");

export function isOverlayOpen(root: ParentNode = document): boolean {
  return root.querySelector(OVERLAY_SELECTOR) !== null;
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

/**
 * New note, from N, the palette or the New menu: the composer on screen,
 * or Everything's, which takes focus once it shows.
 */
export function startNewNote(
  goToView: (view: LibraryView, options?: GoToViewOptions) => void
) {
  if (!focusNewNoteComposer()) {
    goToView("all", { focusComposer: true });
  }
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
