import { SETTINGS_PATHS, TAGS_PATH } from "@teak/convex/shared/webRoutes";
import type { englishMessages } from "@teak/i18n";
import {
  Archive,
  Download,
  FileText,
  Hash,
  Heart,
  Import,
  Keyboard,
  LayoutGrid,
  LogOut,
  Settings,
  Shuffle,
  SunMoon,
  Trash,
  Upload,
  type VadivamIcon,
} from "vadivam-react";
import { LIBRARY_VIEW_PATHS, type LibraryView } from "./libraryViews";

/**
 * The app's commands, in one list: the places `G` then a key goes to and
 * the actions a key or the command palette runs, each with its key, where
 * it goes, its icon and the words the palette finds it by. The shortcut
 * listener, the command palette, the shortcuts list, the sidebar's hints
 * and the New menu all read from here, as card actions read
 * `cardActions.ts`.
 */

type ShortcutRowId = keyof (typeof englishMessages)["shortcuts"]["rows"];
type PaletteLabel = keyof (typeof englishMessages)["commandPalette"]["actions"];

/** How a list shows a key: letters in capitals. */
export const keyName = (key: string): string =>
  key.length === 1 ? key.toUpperCase() : key;

export type GoToTarget = LibraryView | "tags" | "settings";

interface GoToCommand {
  href: string;
  icon: VadivamIcon;
  /** Pressed after G, as `KeyboardEvent.key`. */
  key: string;
  /** English words the palette also finds it by, besides its name. */
  keywords: readonly string[];
  /** Its row in the shortcuts list. */
  listRow: ShortcutRowId;
}

const VIEW_KEYWORDS = ["go to", "view"] as const;

export const GO_TO: Record<GoToTarget, GoToCommand> = {
  all: {
    href: LIBRARY_VIEW_PATHS.all,
    icon: LayoutGrid,
    key: "e",
    keywords: VIEW_KEYWORDS,
    listRow: "goToEverything",
  },
  favorites: {
    href: LIBRARY_VIEW_PATHS.favorites,
    icon: Heart,
    key: "f",
    keywords: VIEW_KEYWORDS,
    listRow: "goToFavorites",
  },
  archive: {
    href: LIBRARY_VIEW_PATHS.archive,
    icon: Archive,
    key: "a",
    keywords: VIEW_KEYWORDS,
    listRow: "goToArchive",
  },
  trash: {
    href: LIBRARY_VIEW_PATHS.trash,
    icon: Trash,
    key: "t",
    keywords: VIEW_KEYWORDS,
    listRow: "goToTrash",
  },
  // `G T` is Trash, so Tags takes `G L`, as Gmail's go to label does.
  tags: {
    href: TAGS_PATH,
    icon: Hash,
    key: "l",
    keywords: ["labels"],
    listRow: "goToTags",
  },
  settings: {
    href: SETTINGS_PATHS.account,
    icon: Settings,
    key: "s",
    keywords: ["account", "preferences", "billing"],
    listRow: "goToSettings",
  },
};

export const GO_TO_TARGETS = Object.keys(GO_TO) as GoToTarget[];

export const isLibraryViewTarget = (
  target: GoToTarget
): target is LibraryView => target !== "tags" && target !== "settings";

/** The keys a hint or the shortcuts list shows: `G E`. */
export const goToKeys = (target: GoToTarget): string[] => [
  "G",
  keyName(GO_TO[target].key),
];

/** The sequence the shortcut listener answers: `g e`. */
export const goToSequence = (target: GoToTarget): string =>
  `g ${GO_TO[target].key}`;

export type AppActionId =
  | "search"
  | "newNote"
  | "uploadFiles"
  | "recordAudio"
  | "import"
  | "export"
  | "toggleTheme"
  | "shuffle"
  | "keyboardShortcuts"
  | "emptyTrash"
  | "signOut"
  | "commandPalette";

interface PaletteEntry {
  icon: VadivamIcon;
  /** English words the filter matches besides the label. */
  keywords: readonly string[];
  label: PaletteLabel;
  /** Offered only on this library page. */
  view?: LibraryView;
}

interface AppAction {
  /**
   * As `KeyboardEvent.key`, pressed alone. The palette's own key is held
   * with the shortcut key (⌘ or Ctrl).
   */
  key?: string;
  palette?: PaletteEntry;
}

/** In the order the palette lists them. */
export const APP_ACTIONS: Record<AppActionId, AppAction> = {
  search: { key: "/" },
  newNote: {
    key: "n",
    palette: {
      icon: FileText,
      keywords: ["write", "text", "add"],
      label: "newNote",
    },
  },
  uploadFiles: {
    key: "u",
    palette: {
      icon: Upload,
      keywords: ["file", "image", "add"],
      label: "upload",
    },
  },
  recordAudio: { key: "r" },
  import: {
    palette: {
      icon: Import,
      keywords: ["bookmarks", "pocket", "data"],
      label: "import",
    },
  },
  export: {
    palette: {
      icon: Download,
      keywords: ["download", "backup", "data"],
      label: "export",
    },
  },
  toggleTheme: {
    palette: {
      icon: SunMoon,
      keywords: ["dark", "light", "appearance"],
      label: "toggleTheme",
    },
  },
  shuffle: {
    palette: { icon: Shuffle, keywords: ["random", "sort"], label: "shuffle" },
  },
  keyboardShortcuts: {
    key: "?",
    palette: {
      icon: Keyboard,
      keywords: ["keys", "help", "hotkeys"],
      label: "shortcuts",
    },
  },
  emptyTrash: {
    palette: {
      icon: Trash,
      keywords: ["delete", "forever", "clear"],
      label: "emptyTrash",
      view: "trash",
    },
  },
  signOut: {
    palette: {
      icon: LogOut,
      keywords: ["log out", "logout"],
      label: "signOut",
    },
  },
  commandPalette: { key: "k" },
};

export const APP_ACTION_IDS = Object.keys(APP_ACTIONS) as AppActionId[];

/** An action's key as `KeyboardEvent.key`; every caller names one with a key. */
export const appActionKey = (id: AppActionId): string =>
  APP_ACTIONS[id].key ?? "";

/** The key a hint shows for an action, or none. */
export const appActionKeys = (id: AppActionId): string[] => {
  const { key } = APP_ACTIONS[id];
  if (!key) {
    return [];
  }
  return id === "commandPalette" ? ["Mod", keyName(key)] : [keyName(key)];
};
