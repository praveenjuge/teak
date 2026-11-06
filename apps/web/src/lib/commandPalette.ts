import type { CardType } from "@teak/convex/shared/constants";
import { getSafeUrlHostname } from "@teak/convex/shared/utils/safeUrl";
import {
  createTeakTranslator,
  englishMessages,
  type TeakTranslator,
} from "@teak/i18n";
import { cardTitle } from "./cardTypes";
import { englishTranslator } from "./englishTranslators";
import { folderIdForPath } from "./folders";
import { APP_KEYS, isOverlayOpen, keyName } from "./keyboardShortcuts";
import { CARD_PARAM, cardHref, libraryHref, searchWithout } from "./libraryUrl";
import {
  LIBRARY_VIEW_PATHS,
  type LibraryView,
  libraryViewFlags,
  libraryViewForPath,
} from "./libraryViews";
import type { LinkTitleTranslator } from "./linkTitle";
import { isApplePlatform } from "./platform";

const englishPalette = createTeakTranslator(
  "en",
  englishMessages,
  "commandPalette"
);

export const PALETTE_MIN_CARD_QUERY_LENGTH = 2;
export const PALETTE_CARD_LIMIT = 8;

interface PaletteKeyEvent {
  altKey: boolean;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  isComposing?: boolean;
  key: string;
  metaKey: boolean;
  repeat?: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
}

export function isCommandPaletteKey(
  event: PaletteKeyEvent,
  apple = isApplePlatform()
): boolean {
  if (
    event.key.toLowerCase() !== APP_KEYS.commandPalette ||
    event.altKey ||
    event.shiftKey
  ) {
    return false;
  }
  return apple
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

const isInsideEditor = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest("[contenteditable]:not([contenteditable='false'])") !== null;

export function shouldOpenPalette(
  event: PaletteKeyEvent,
  root: ParentNode = document,
  apple = isApplePlatform()
): boolean {
  return (
    isCommandPaletteKey(event, apple) &&
    !event.defaultPrevented &&
    !event.isComposing &&
    !event.repeat &&
    !isInsideEditor(event.target) &&
    !isOverlayOpen(root)
  );
}

export type CommandPaletteActionId =
  | "new-note"
  | "upload"
  | "import"
  | "export"
  | "toggle-theme"
  | "shuffle"
  | "shortcuts"
  | "empty-trash"
  | "sign-out";

export interface CommandPaletteAction {
  id: CommandPaletteActionId;
  keys?: string[];
  /** Extra English words the filter matches besides the label. */
  keywords: string[];
  labelKey: keyof (typeof englishMessages)["commandPalette"]["actions"];
  view?: LibraryView;
}

export const COMMAND_PALETTE_ACTIONS: readonly CommandPaletteAction[] = [
  {
    id: "new-note",
    keywords: ["write", "text", "add"],
    keys: [keyName(APP_KEYS.newNote)],
    labelKey: "newNote",
  },
  {
    id: "upload",
    keywords: ["file", "image", "add"],
    keys: [keyName(APP_KEYS.uploadFiles)],
    labelKey: "upload",
  },
  {
    id: "import",
    keywords: ["bookmarks", "pocket", "data"],
    labelKey: "import",
  },
  {
    id: "export",
    keywords: ["download", "backup", "data"],
    labelKey: "export",
  },
  {
    id: "toggle-theme",
    keywords: ["dark", "light", "appearance"],
    labelKey: "toggleTheme",
  },
  { id: "shuffle", keywords: ["random", "sort"], labelKey: "shuffle" },
  {
    id: "shortcuts",
    keywords: ["keys", "help", "hotkeys"],
    keys: [keyName(APP_KEYS.keyboardShortcuts)],
    labelKey: "shortcuts",
  },
  {
    id: "empty-trash",
    keywords: ["delete", "forever", "clear"],
    labelKey: "emptyTrash",
    view: "trash",
  },
  { id: "sign-out", keywords: ["log out", "logout"], labelKey: "signOut" },
];

export const paletteActions = (pathname: string | null | undefined) => {
  const view = libraryViewForPath(pathname);
  return COMMAND_PALETTE_ACTIONS.filter(
    (action) => !action.view || action.view === view
  );
};

export function isLibraryRoute(pathname: string | null | undefined): boolean {
  return (
    libraryViewForPath(pathname) !== null || folderIdForPath(pathname) !== null
  );
}

/** A card opens over the library page it was found from, or over Everything. */
export const paletteCardHref = (
  cardId: string,
  pathname: string | null | undefined,
  search = ""
): string =>
  pathname && isLibraryRoute(pathname)
    ? cardHref(cardId, pathname, search)
    : cardHref(cardId);

/** Searching everything searches the Archive from the Archive. */
const paletteSearchView = (pathname: string | null | undefined) =>
  libraryViewFlags(libraryViewForPath(pathname) ?? "all").showArchivedOnly
    ? "archive"
    : "all";

export const paletteSearchAllHref = (query: string, pathname?: string | null) =>
  libraryHref(
    LIBRARY_VIEW_PATHS[paletteSearchView(pathname)],
    new URLSearchParams({ q: query.trim() })
  );

export function paletteShuffleHref(
  pathname: string | null | undefined,
  search = ""
): string {
  const onLibrary = Boolean(pathname && isLibraryRoute(pathname));
  const params = onLibrary
    ? searchWithout(search, CARD_PARAM, "seed")
    : new URLSearchParams();
  params.set("sort", "shuffle");
  return libraryHref(onLibrary && pathname ? pathname : "/", params);
}

export type SettingsDialogTab = "import" | "export";

/** The tab an old `/settings?dialog=` link asked for. */
export function parseSettingsDialogParam(
  value: string | null | undefined
): SettingsDialogTab | null {
  return value === "import" || value === "export" ? value : null;
}

export const settingsDataHref = (tab: SettingsDialogTab) =>
  `/settings/data#${tab}`;

export function paletteCardSearchArgs(
  query: string,
  pathname: string | null | undefined
) {
  return {
    searchQuery: query.trim(),
    ...(paletteSearchView(pathname) === "archive"
      ? { showArchivedOnly: true }
      : {}),
  };
}

export interface PaletteCard {
  _id: string;
  content?: string;
  fileMetadata?: { fileName?: string };
  metadata?: {
    linkPreview?: { status?: string; title?: string };
  };
  metadataTitle?: string;
  metadataTitleEdited?: boolean;
  type: CardType;
  url?: string;
  urlHost?: string;
}

const MAX_PALETTE_TITLE_LENGTH = 300;

export function paletteCardTitle(
  card: PaletteCard,
  t: TeakTranslator<"commandPalette"> = englishPalette,
  linkTitle: LinkTitleTranslator = englishTranslator("lib.linkTitle")
): string {
  return (cardTitle(card, linkTitle) || t("cards.untitled")).slice(
    0,
    MAX_PALETTE_TITLE_LENGTH
  );
}

export function paletteCardHost(card: PaletteCard): string | undefined {
  if (card.type !== "link") {
    return;
  }
  const host = card.urlHost || getSafeUrlHostname(card.url);
  return host?.replace(/^www\./, "") || undefined;
}
