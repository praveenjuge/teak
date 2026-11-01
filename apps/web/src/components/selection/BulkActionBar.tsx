import { useTranslations } from "@teak/i18n/react";
import type { ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  Ellipsis,
  FolderInput,
  FolderMinus,
  FolderPlus,
  Heart,
  HeartOff,
  Link as LinkIcon,
  RotateCcw,
  Tag,
  Tags,
  Trash,
  X,
} from "vadivam-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BulkCardAction } from "../../lib/bulkCardActions";
import { selectionShortcut } from "../../lib/gridKeys";
import type { MenuShortcut } from "../../lib/keyboardShortcuts";
import { ShortcutTooltip } from "../shortcuts/ShortcutTooltip";

export type BulkBarView = "library" | "archive" | "trash";

export type BulkBarAction = BulkCardAction | "copyLinks" | "deleteForever";

export interface BulkBarFolder {
  id: string;
  name: string;
}

interface BulkActionBarProps {
  addToFolder?: BulkBarFolder;
  allFavorited?: boolean;
  folder?: BulkBarFolder;
  isBusy?: boolean;
  onAction: (action: BulkBarAction) => void;
  onCancel: () => void;
  selectedCount: number;
  view?: BulkBarView;
}

const PRIMARY: Record<
  BulkBarView,
  {
    action: BulkCardAction;
    icon: typeof Archive;
    labelKey: "archive" | "unarchive" | "restore";
  }
> = {
  library: { action: "archive", icon: Archive, labelKey: "archive" },
  archive: {
    action: "unarchive",
    icon: ArchiveRestore,
    labelKey: "unarchive",
  },
  trash: { action: "restore", icon: RotateCcw, labelKey: "restore" },
};

export function BulkActionBar({
  addToFolder,
  allFavorited = false,
  folder,
  selectedCount,
  onAction,
  onCancel,
  view = "library",
  isBusy = false,
}: BulkActionBarProps) {
  const t = useTranslations("selection.bar");
  const tc = useTranslations("common");
  const primary = addToFolder
    ? {
        action: "addToFolder" as const,
        icon: FolderPlus,
        label: t("addToNamedFolder", { folder: addToFolder.name }),
      }
    : { ...PRIMARY[view], label: t(PRIMARY[view].labelKey) };
  const PrimaryIcon = primary.icon;
  const disabled = selectedCount === 0 || isBusy;
  const shortcutFor = (action: BulkBarAction) =>
    selectionShortcut(action, {
      addToFolder: Boolean(addToFolder),
      allSelectedFavorited: allFavorited,
      view,
    });
  const primaryShortcut = shortcutFor(primary.action);
  const primaryKeys = primaryShortcut ? [primaryShortcut.label] : undefined;
  // Archive and Restore are everyday actions, so they stay neutral; the
  // brand red is kept for adding picked cards to a folder.
  const primaryButton = (
    <Button
      aria-keyshortcuts={primaryShortcut?.keys}
      className="max-w-[55%]"
      disabled={disabled}
      onClick={() => onAction(primary.action)}
      size="sm"
      title={primaryKeys ? undefined : primary.label}
      variant={addToFolder ? "default" : "secondary"}
    >
      <PrimaryIcon />
      <span className="truncate">{primary.label}</span>
    </Button>
  );
  const deleteForeverShortcut = shortcutFor("deleteForever");
  const deleteForeverButton =
    view === "trash" && !addToFolder ? (
      <Button
        aria-keyshortcuts={deleteForeverShortcut?.keys}
        className="text-destructive hover:text-destructive"
        disabled={disabled}
        onClick={() => onAction("deleteForever")}
        size="sm"
        variant="outline"
      >
        <Trash />
        <span className="max-sm:sr-only">{t("deleteForever")}</span>
      </Button>
    ) : null;

  return (
    <div className="fade-in-0 fixed top-0 right-0 left-(--teak-content-left) z-50 animate-in border-b bg-background pt-[env(safe-area-inset-top)] transition-[left] duration-150 ease-out">
      <div className="mx-auto flex h-13 max-w-7xl items-center gap-2 px-4">
        <span
          aria-live="polite"
          className="mr-auto truncate font-medium text-sm tabular-nums"
        >
          {addToFolder && selectedCount === 0
            ? t("chooseCards")
            : t("selectedCount", { count: selectedCount })}
        </span>
        {primaryKeys ? (
          <ShortcutTooltip keys={primaryKeys} label={primary.label}>
            {primaryButton}
          </ShortcutTooltip>
        ) : (
          primaryButton
        )}
        {deleteForeverButton && deleteForeverShortcut ? (
          <ShortcutTooltip
            keys={[deleteForeverShortcut.label]}
            label={t("deleteForever")}
          >
            {deleteForeverButton}
          </ShortcutTooltip>
        ) : (
          deleteForeverButton
        )}
        {view !== "trash" && !addToFolder && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={t("moreActions")}
                disabled={disabled}
                size="sm"
                variant="outline"
              >
                <Ellipsis />
                <span className="max-sm:sr-only">{tc("more")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <BarMenuItem
                action="favorite"
                onAction={onAction}
                shortcut={shortcutFor("favorite")}
              >
                <Heart />
                {t("favorite")}
              </BarMenuItem>
              <BarMenuItem
                action="unfavorite"
                onAction={onAction}
                shortcut={shortcutFor("unfavorite")}
              >
                <HeartOff />
                {t("unfavorite")}
              </BarMenuItem>
              <DropdownMenuSeparator />
              <BarMenuItem
                action="addTags"
                onAction={onAction}
                shortcut={shortcutFor("addTags")}
              >
                <Tag />
                {t("addTags")}
              </BarMenuItem>
              <DropdownMenuItem onSelect={() => onAction("removeTags")}>
                <Tags />
                {t("removeTags")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction("copyLinks")}>
                <LinkIcon />
                {t("copyLinks")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onAction("addToFolder")}>
                <FolderPlus />
                {t("addToFolder")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction("moveToFolder")}>
                <FolderInput />
                {t("moveToFolder")}
              </DropdownMenuItem>
              {folder ? (
                <DropdownMenuItem onSelect={() => onAction("removeFromFolder")}>
                  <FolderMinus />
                  <span className="truncate">
                    {t("removeFromFolder", { folder: folder.name })}
                  </span>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <BarMenuItem
                action="delete"
                onAction={onAction}
                shortcut={shortcutFor("delete")}
                variant="destructive"
              >
                <Trash />
                {t("moveToTrash")}
              </BarMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <ShortcutTooltip keys={["Esc"]} label={t("cancelSelection")}>
          <Button
            aria-keyshortcuts="Escape"
            aria-label={t("cancelSelection")}
            className="size-8"
            onClick={onCancel}
            size="icon"
            variant="ghost"
          >
            <X />
          </Button>
        </ShortcutTooltip>
      </div>
    </div>
  );
}

function BarMenuItem({
  action,
  children,
  onAction,
  shortcut,
  variant,
}: {
  action: BulkBarAction;
  children: ReactNode;
  onAction: (action: BulkBarAction) => void;
  shortcut?: MenuShortcut;
  variant?: "destructive";
}) {
  return (
    <DropdownMenuItem
      aria-keyshortcuts={shortcut?.keys}
      onSelect={() => onAction(action)}
      variant={variant}
    >
      {children}
      {shortcut ? (
        <DropdownMenuShortcut aria-hidden>
          {shortcut.label}
        </DropdownMenuShortcut>
      ) : null}
    </DropdownMenuItem>
  );
}
