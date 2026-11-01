"use client";

import { api } from "@teak/convex";
import { useTranslations } from "@teak/i18n/react";
import { defaultFilter } from "cmdk";
import { useQueries } from "convex-helpers/react/cache/hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FileText,
  FolderSearch,
  Hash,
  Import,
  Keyboard,
  LogOut,
  Search,
  Settings,
  Shuffle,
  SunMoon,
  Trash,
  Upload,
  type VadivamIcon,
} from "vadivam-react";
import { REMOTE_SEARCH_DEBOUNCE_MS } from "../../hooks/useCardsSearchController";
import { useFolders } from "../../hooks/useFolders";
import { useNetworkStatus } from "../../hooks/useNetworkStatus";
import {
  type CommandPaletteActionId,
  PALETTE_CARD_LIMIT,
  PALETTE_MIN_CARD_QUERY_LENGTH,
  type PaletteCard,
  paletteActions,
  paletteCardHost,
  paletteCardSearchArgs,
  paletteCardTitle,
} from "../../lib/commandPalette";
import {
  FOLDER_ICON_CLASSES,
  type FolderSummary,
  folderPath,
} from "../../lib/folders";
import {
  GO_TO_SETTINGS_KEY,
  GO_TO_VIEW_KEYS,
} from "../../lib/keyboardShortcuts";
import {
  LIBRARY_VIEW_PATHS,
  LIBRARY_VIEWS,
  libraryViewLabel,
} from "../../lib/libraryViews";
import {
  SETTINGS_SECTION_KEYWORDS,
  SETTINGS_SECTIONS,
} from "../../lib/settingsSections";
import { getCardTypeIconComponent } from "../card-modal/cardTypeIcon";
import { FolderDot } from "../folders/FolderDot";
import { ShortcutHint } from "../modals/KeyboardShortcutsDialog";
import { LIBRARY_VIEW_ICONS } from "../sidebar/AppSidebar";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { Skeleton } from "../ui/skeleton";

export type CommandPaletteCommand =
  | { kind: "navigate"; href: string }
  | { kind: "card"; cardId: string }
  | { kind: "search"; query: string }
  | { kind: "action"; id: CommandPaletteActionId };

export type PaletteCardsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; cards: PaletteCard[] };

const ACTION_ICONS: Record<CommandPaletteActionId, VadivamIcon> = {
  "new-note": FileText,
  upload: Upload,
  import: Import,
  export: Download,
  "toggle-theme": SunMoon,
  shuffle: Shuffle,
  shortcuts: Keyboard,
  "empty-trash": Trash,
  "sign-out": LogOut,
};

const CARD_SCORE = 0.5;
const SEARCH_ALL_SCORE = 0.01;

export function filterPaletteItem(
  value: string,
  search: string,
  keywords?: string[]
): number {
  if (value.startsWith("card:")) {
    return CARD_SCORE;
  }
  if (value === "search-all") {
    return SEARCH_ALL_SCORE;
  }
  if (!keywords?.length) {
    return 0;
  }
  const [label = "", ...rest] = keywords;
  return defaultFilter(label, search, rest);
}

interface CommandPaletteResultsProps {
  cards: PaletteCardsState;
  folders: readonly FolderSummary[] | undefined;
  onSelect: (command: CommandPaletteCommand) => void;
  pathname?: string | null;
  query: string;
}

export function CommandPaletteResults({
  cards,
  folders,
  onSelect,
  pathname,
  query,
}: CommandPaletteResultsProps) {
  const t = useTranslations("commandPalette");
  const tViews = useTranslations("lib.libraryViews");
  const tSettingsNav = useTranslations("settings.nav");
  const trimmed = query.trim();
  return (
    <>
      {/* cmdk doesn't count the server's card rows. */}
      {(cards.status === "idle" ||
        (cards.status === "ready" && cards.cards.length === 0)) && (
        <CommandEmpty className="py-4 text-center text-[13px] text-muted-foreground">
          {t("noResults")}
        </CommandEmpty>
      )}
      <CommandGroup heading={t("groups.navigate")}>
        {LIBRARY_VIEWS.map((view) => {
          const Icon = LIBRARY_VIEW_ICONS[view];
          const label = libraryViewLabel(view, tViews);
          return (
            <CommandItem
              key={view}
              keywords={[label, "go to", "view"]}
              onSelect={() =>
                onSelect({ kind: "navigate", href: LIBRARY_VIEW_PATHS[view] })
              }
              value={`view:${view}`}
            >
              <Icon />
              <span className="truncate">{label}</span>
              <span aria-hidden="true" className="ml-auto">
                <ShortcutHint
                  row={{
                    keys: ["G", GO_TO_VIEW_KEYS[view].toUpperCase()],
                    label,
                    sequence: true,
                  }}
                />
              </span>
            </CommandItem>
          );
        })}
        <CommandItem
          keywords={[t("views.tags"), "labels"]}
          onSelect={() => onSelect({ kind: "navigate", href: "/tags" })}
          value="view:tags"
        >
          <Hash />
          <span>{t("views.tags")}</span>
        </CommandItem>
        <CommandItem
          keywords={[t("views.settings"), "account", "preferences", "billing"]}
          onSelect={() => onSelect({ kind: "navigate", href: "/settings" })}
          value="view:settings"
        >
          <Settings />
          <span>{t("views.settings")}</span>
          <span aria-hidden="true" className="ml-auto">
            <ShortcutHint
              row={{
                keys: ["G", GO_TO_SETTINGS_KEY.toUpperCase()],
                label: t("views.settings"),
                sequence: true,
              }}
            />
          </span>
        </CommandItem>
      </CommandGroup>
      {trimmed.length >= PALETTE_MIN_CARD_QUERY_LENGTH &&
        !(cards.status === "ready" && cards.cards.length === 0) && (
          <CommandGroup forceMount heading={t("groups.cards")}>
            <PaletteCardRows
              cards={cards}
              onSelect={onSelect}
              query={trimmed}
            />
          </CommandGroup>
        )}
      <CommandGroup heading={t("groups.actions")}>
        {paletteActions(pathname).map((action) => {
          const Icon = ACTION_ICONS[action.id];
          const label = t(`actions.${action.labelKey}`);
          return (
            <CommandItem
              key={action.id}
              keywords={[label, ...action.keywords]}
              onSelect={() => onSelect({ kind: "action", id: action.id })}
              value={`action:${action.id}`}
            >
              <Icon />
              <span className="truncate">{label}</span>
              {action.keys ? (
                <span aria-hidden="true" className="ml-auto">
                  <ShortcutHint row={{ keys: action.keys, label }} />
                </span>
              ) : null}
            </CommandItem>
          );
        })}
      </CommandGroup>
      <CommandGroup heading={t("groups.settings")}>
        {SETTINGS_SECTIONS.filter(({ id }) => id !== "account").map(
          ({ href, icon: Icon, id }) => {
            const section = tSettingsNav(id);
            const label = t("settingsSection", { section });
            return (
              <CommandItem
                key={id}
                keywords={[
                  label,
                  section,
                  "settings",
                  ...SETTINGS_SECTION_KEYWORDS[id],
                ]}
                onSelect={() => onSelect({ kind: "navigate", href })}
                value={`settings:${id}`}
              >
                <Icon />
                <span className="truncate">{label}</span>
              </CommandItem>
            );
          }
        )}
      </CommandGroup>
      {folders && folders.length > 0 && (
        <CommandGroup heading={t("groups.folders")}>
          {folders.map((folder) => (
            <CommandItem
              key={folder._id}
              keywords={[
                folder.name,
                folder.kind === "smart" ? "smart folder" : "folder",
              ]}
              onSelect={() =>
                onSelect({ kind: "navigate", href: folderPath(folder._id) })
              }
              title={folder.name}
              value={`folder:${folder._id}`}
            >
              {folder.kind === "smart" ? (
                <FolderSearch
                  aria-label={t("smartFolder")}
                  className={
                    folder.color ? FOLDER_ICON_CLASSES[folder.color] : undefined
                  }
                />
              ) : (
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <FolderDot className="size-[7px]" color={folder.color} />
                </span>
              )}
              <span className="min-w-0 truncate" dir="auto">
                {folder.name}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
    </>
  );
}

function PaletteCardRows({
  cards,
  onSelect,
  query,
}: {
  cards: PaletteCardsState;
  onSelect: (command: CommandPaletteCommand) => void;
  query: string;
}) {
  const t = useTranslations("commandPalette");
  const tLinkTitle = useTranslations("lib.linkTitle");
  if (cards.status === "loading" || cards.status === "idle") {
    return (
      <div
        aria-label={t("cards.searching")}
        className="space-y-1 px-2 py-1"
        role="status"
      >
        {[0, 1, 2].map((row) => (
          <div className="flex h-7 items-center gap-2" key={row}>
            <Skeleton className="size-4 rounded-sm" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        ))}
      </div>
    );
  }
  if (cards.status === "error") {
    return (
      <p className="px-2 py-1 text-[13px] text-muted-foreground" role="status">
        {t("cards.searchFailed")}
      </p>
    );
  }
  return (
    <>
      {cards.cards.map((card) => {
        const Icon = getCardTypeIconComponent(card.type);
        const title = paletteCardTitle(card, t, tLinkTitle);
        const host = paletteCardHost(card);
        return (
          <CommandItem
            forceMount
            key={card._id}
            onSelect={() => onSelect({ kind: "card", cardId: card._id })}
            title={title}
            value={`card:${card._id}`}
          >
            <Icon />
            <span className="min-w-0 flex-1 truncate" dir="auto">
              {title}
            </span>
            {host && (
              <span className="max-w-[40%] shrink-0 truncate text-muted-foreground text-xs">
                {host}
              </span>
            )}
          </CommandItem>
        );
      })}
      <CommandItem
        forceMount
        onSelect={() => onSelect({ kind: "search", query })}
        value="search-all"
      >
        <Search />
        <span className="min-w-0 truncate" dir="auto">
          {t("cards.searchAll", { query })}
        </span>
      </CommandItem>
    </>
  );
}

function usePaletteCards(query: string, pathname: string | null) {
  const { isOnline } = useNetworkStatus();
  const trimmed = query.trim();
  const [debounced, setDebounced] = useState(trimmed);
  useEffect(() => {
    const timer = setTimeout(
      () => setDebounced(trimmed),
      REMOTE_SEARCH_DEBOUNCE_MS
    );
    return () => clearTimeout(timer);
  }, [trimmed]);
  const active = debounced.length >= PALETTE_MIN_CARD_QUERY_LENGTH;
  const queries = useMemo(() => {
    const map: Parameters<typeof useQueries>[0] = {};
    if (active) {
      map.cards = {
        query: api.cards.searchCardsPaginated,
        args: {
          ...paletteCardSearchArgs(debounced, pathname),
          paginationOpts: { cursor: null, numItems: PALETTE_CARD_LIMIT },
        },
      };
    }
    return map;
  }, [active, debounced, pathname]);
  const result = useQueries(queries).cards as
    | { page: PaletteCard[] }
    | Error
    | undefined;

  if (trimmed.length < PALETTE_MIN_CARD_QUERY_LENGTH) {
    return { status: "idle" } as const;
  }
  if (!isOnline || result instanceof Error) {
    return { status: "error" } as const;
  }
  if (debounced !== trimmed || result === undefined) {
    return { status: "loading" } as const;
  }
  return {
    status: "ready",
    cards: result.page.slice(0, PALETTE_CARD_LIMIT),
  } as const;
}

interface CommandPaletteProps {
  onCloseAutoFocus?: (event: Event) => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (command: CommandPaletteCommand) => void;
  open: boolean;
  pathname: string | null;
}

export function CommandPalette({
  onCloseAutoFocus,
  onOpenChange,
  onSelect,
  open,
  pathname,
}: CommandPaletteProps) {
  const t = useTranslations("commandPalette");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const folders = useFolders();
  const cards = usePaletteCards(open ? query : "", pathname);
  const cardsKey =
    cards.status === "ready"
      ? cards.cards.map((card) => card._id).join(",")
      : cards.status;

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelected("");
    }
  }, [open]);

  // cmdk keeps its selection when card rows arrive and may sort above it,
  // so select the first row then.
  useEffect(() => {
    if (!cardsKey) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const first = listRef.current?.querySelector<HTMLElement>(
        "[cmdk-item]:not([aria-disabled='true'])"
      );
      setSelected(first?.dataset.value ?? "");
    });
    return () => cancelAnimationFrame(frame);
  }, [cardsKey]);

  return (
    <CommandDialog
      className="top-[20vh] w-[calc(100%-1rem)] max-w-[520px] translate-y-0 rounded-xl duration-150 sm:max-w-[520px]"
      commandProps={{
        filter: filterPaletteItem,
        loop: true,
        onValueChange: setSelected,
        value: selected,
        vimBindings: false,
      }}
      description={t("description")}
      onCloseAutoFocus={onCloseAutoFocus}
      onOpenChange={onOpenChange}
      open={open}
      title={t("title")}
    >
      <CommandInput
        aria-label={t("inputLabel")}
        onValueChange={setQuery}
        placeholder={t("placeholder")}
        value={query}
      />
      <CommandList
        aria-label={t("resultsLabel")}
        className="max-h-[min(50vh,360px)] pb-1"
        ref={listRef}
      >
        <CommandPaletteResults
          cards={cards}
          folders={folders}
          onSelect={onSelect}
          pathname={pathname}
          query={query}
        />
      </CommandList>
    </CommandDialog>
  );
}
