import type { CardType } from "@teak/convex/shared/constants";
import { getSafeUrlHostname } from "@teak/convex/shared/utils/safeUrl";
import {
  createTeakTranslator,
  englishMessages,
  type TeakTranslator,
} from "@teak/i18n";
import { isOverlayOpen } from "../hooks/useKeyboardShortcuts";
import { englishTranslator } from "./englishTranslators";
import { folderIdForPath } from "./folders";
import { type LibraryView, libraryViewForPath } from "./libraryViews";
import { type LinkTitleTranslator, resolveLinkTitle } from "./linkTitle";
import { markdownToPlainText } from "./markdownToPlainText";
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
  if (event.key.toLowerCase() !== "k" || event.altKey || event.shiftKey) {
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
    keys: ["N"],
    labelKey: "newNote",
  },
  {
    id: "upload",
    keywords: ["file", "image", "add"],
    keys: ["U"],
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
    keys: ["?"],
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

let emptyTrashHandler: (() => void) | null = null;

export function registerEmptyTrash(handler: () => void): () => void {
  emptyTrashHandler = handler;
  return () => {
    if (emptyTrashHandler === handler) {
      emptyTrashHandler = null;
    }
  };
}

export function requestEmptyTrash(): boolean {
  if (!emptyTrashHandler) {
    return false;
  }
  emptyTrashHandler();
  return true;
}

export function isLibraryRoute(pathname: string | null | undefined): boolean {
  return (
    libraryViewForPath(pathname) !== null || folderIdForPath(pathname) !== null
  );
}

export function paletteCardHref(
  cardId: string,
  pathname: string | null | undefined,
  search = ""
): string {
  if (!(pathname && isLibraryRoute(pathname))) {
    return `/?card=${encodeURIComponent(cardId)}`;
  }
  const params = new URLSearchParams(search);
  params.set("card", cardId);
  return `${pathname}?${params.toString().replace(/%2C/g, ",")}`;
}

export const paletteSearchAllHref = (query: string, pathname?: string | null) =>
  `${libraryViewForPath(pathname) === "archive" ? "/archive" : "/"}?q=${encodeURIComponent(query.trim())}`;

export function paletteShuffleHref(
  pathname: string | null | undefined,
  search = ""
): string {
  if (!(pathname && isLibraryRoute(pathname))) {
    return "/?sort=shuffle";
  }
  const params = new URLSearchParams(search);
  params.delete("card");
  params.delete("seed");
  params.set("sort", "shuffle");
  return `${pathname}?${params.toString().replace(/%2C/g, ",")}`;
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
  const view = libraryViewForPath(pathname);
  return {
    searchQuery: query.trim(),
    ...(view === "archive" ? { showArchivedOnly: true } : {}),
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
  const isFileCard =
    card.type === "image" ||
    card.type === "video" ||
    card.type === "audio" ||
    card.type === "document";
  const linkPreview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;
  const title =
    (card.type === "link"
      ? resolveLinkTitle(
          {
            metadataTitle: card.metadataTitle,
            metadataTitleEdited: card.metadataTitleEdited,
            previewTitle: linkPreview?.title,
            url: card.url,
          },
          linkTitle
        )
      : "") ||
    (isFileCard ? card.fileMetadata?.fileName : "") ||
    card.metadataTitle ||
    markdownToPlainText(card.content?.trim().split("\n", 1)[0]).trim() ||
    card.fileMetadata?.fileName ||
    t("cards.untitled");
  return title.slice(0, MAX_PALETTE_TITLE_LENGTH);
}

export function paletteCardHost(card: PaletteCard): string | undefined {
  if (card.type !== "link") {
    return;
  }
  const host = card.urlHost || getSafeUrlHostname(card.url);
  return host?.replace(/^www\./, "") || undefined;
}
