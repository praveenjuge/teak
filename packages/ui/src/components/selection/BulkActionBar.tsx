import { Button } from "@teak/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@teak/ui/components/ui/dropdown-menu";
import {
  Archive,
  ArchiveRestore,
  FolderInput,
  FolderMinus,
  FolderPlus,
  Heart,
  HeartOff,
  Link as LinkIcon,
  MoreHorizontal,
  RotateCcw,
  Tag,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { type BulkCardAction, cardCountLabel } from "../../lib/bulkCardActions";
import { selectionShortcut } from "../../lib/gridKeys";
import type { MenuShortcut } from "../../lib/keyboardShortcuts";
import { ShortcutTooltip } from "../shortcuts/ShortcutTooltip";

export type BulkBarView = "library" | "archive" | "trash";

export type BulkBarAction = BulkCardAction | "copyLinks";

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
  { action: BulkCardAction; icon: typeof Archive; label: string }
> = {
  library: { action: "archive", icon: Archive, label: "Archive" },
  archive: { action: "unarchive", icon: ArchiveRestore, label: "Unarchive" },
  trash: { action: "restore", icon: RotateCcw, label: "Restore" },
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
  const primary = addToFolder
    ? {
        action: "addToFolder" as const,
        icon: FolderPlus,
        label: `Add to ${addToFolder.name}`,
      }
    : PRIMARY[view];
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
  const primaryButton = (
    <Button
      aria-keyshortcuts={primaryShortcut?.keys}
      className="max-w-[55%]"
      disabled={disabled}
      onClick={() => onAction(primary.action)}
      size="sm"
      title={primaryKeys ? undefined : primary.label}
    >
      <PrimaryIcon />
      <span className="truncate">{primary.label}</span>
    </Button>
  );

  return (
    <div className="fade-in-0 fixed top-0 right-0 left-(--teak-content-left) z-50 animate-in border-b bg-background pt-[env(safe-area-inset-top)] transition-[left] duration-150 ease-out">
      <div className="mx-auto flex h-13 max-w-7xl items-center gap-2 px-4">
        <span
          aria-live="polite"
          className="mr-auto truncate font-medium text-sm tabular-nums"
        >
          {addToFolder && selectedCount === 0
            ? "Choose cards to add"
            : `${cardCountLabel(selectedCount)} selected`}
        </span>
        {primaryKeys ? (
          <ShortcutTooltip keys={primaryKeys} label={primary.label}>
            {primaryButton}
          </ShortcutTooltip>
        ) : (
          primaryButton
        )}
        {view !== "trash" && !addToFolder && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="More actions"
                disabled={disabled}
                size="sm"
                variant="outline"
              >
                <MoreHorizontal />
                <span className="max-sm:sr-only">More</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <BarMenuItem
                action="favorite"
                onAction={onAction}
                shortcut={shortcutFor("favorite")}
              >
                <Heart />
                Add to favorites
              </BarMenuItem>
              <BarMenuItem
                action="unfavorite"
                onAction={onAction}
                shortcut={shortcutFor("unfavorite")}
              >
                <HeartOff />
                Remove from favorites
              </BarMenuItem>
              <DropdownMenuSeparator />
              <BarMenuItem
                action="addTags"
                onAction={onAction}
                shortcut={shortcutFor("addTags")}
              >
                <Tag />
                Add tags…
              </BarMenuItem>
              <DropdownMenuItem onSelect={() => onAction("removeTags")}>
                <Tags />
                Remove tags…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction("copyLinks")}>
                <LinkIcon />
                Copy links
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onAction("addToFolder")}>
                <FolderPlus />
                Add to folder…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction("moveToFolder")}>
                <FolderInput />
                Move to folder…
              </DropdownMenuItem>
              {folder && (
                <DropdownMenuItem onSelect={() => onAction("removeFromFolder")}>
                  <FolderMinus />
                  <span className="truncate">Remove from {folder.name}</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <BarMenuItem
                action="delete"
                onAction={onAction}
                shortcut={shortcutFor("delete")}
                variant="destructive"
              >
                <Trash2 />
                Move to Trash
              </BarMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <ShortcutTooltip keys={["Esc"]} label="Cancel selection">
          <Button
            aria-keyshortcuts="Escape"
            aria-label="Cancel selection"
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
      {shortcut && (
        <DropdownMenuShortcut aria-hidden>
          {shortcut.label}
        </DropdownMenuShortcut>
      )}
    </DropdownMenuItem>
  );
}
