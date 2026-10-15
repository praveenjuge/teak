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
import { type BulkCardAction, cardCountLabel } from "../../lib/bulkCardActions";
import { cardMenuShortcuts } from "../../lib/keyboardShortcuts";
import { ShortcutTooltip } from "../shortcuts/ShortcutTooltip";

/** Which grid the selection is in; it decides the bar's actions. */
export type BulkBarView = "library" | "archive" | "trash";

/** A bar action: a bulk card action, or copying the selection's links. */
export type BulkBarAction = BulkCardAction | "copyLinks";

/** A folder the bar acts on: the one being viewed, or the one being filled. */
export interface BulkBarFolder {
  id: string;
  name: string;
}

interface BulkActionBarProps {
  /**
   * Choosing cards for this folder ("Add cards" from an empty folder): the
   * bar's one action adds the selection to it.
   */
  addToFolder?: BulkBarFolder;
  /**
   * Whether every selected card is a favorite: then F removes them from
   * favorites rather than adding them, and the menu shows F there.
   */
  allFavorited?: boolean;
  /** The folder being viewed, which Remove from folder takes cards out of. */
  folder?: BulkBarFolder;
  /** True while a bulk action runs; the actions wait for it. */
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
  // The keys a focused card takes for the whole selection (see MasonryGrid).
  const shortcuts = cardMenuShortcuts();
  // E archives (or unarchives) the selection; Restore and Add to folder
  // have no key.
  const primaryKeys =
    addToFolder || view === "trash" ? undefined : [shortcuts.archive.label];
  const primaryButton = (
    <Button
      aria-keyshortcuts={primaryKeys ? shortcuts.archive.keys : undefined}
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

  // Takes the page header's place across the top of the content column
  // (beside the sidebar), the same height, so selecting swaps the bar in
  // place; like the toasts at the bottom, it never covers the sidebar.
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
              <DropdownMenuItem
                aria-keyshortcuts={
                  allFavorited ? undefined : shortcuts.favorite.keys
                }
                onSelect={() => onAction("favorite")}
              >
                <Heart />
                Add to favorites
                {!allFavorited && (
                  <DropdownMenuShortcut aria-hidden>
                    {shortcuts.favorite.label}
                  </DropdownMenuShortcut>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem
                aria-keyshortcuts={
                  allFavorited ? shortcuts.favorite.keys : undefined
                }
                onSelect={() => onAction("unfavorite")}
              >
                <HeartOff />
                Remove from favorites
                {allFavorited && (
                  <DropdownMenuShortcut aria-hidden>
                    {shortcuts.favorite.label}
                  </DropdownMenuShortcut>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                aria-keyshortcuts={shortcuts.addTags.keys}
                onSelect={() => onAction("addTags")}
              >
                <Tag />
                Add tags…
                <DropdownMenuShortcut aria-hidden>
                  {shortcuts.addTags.label}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
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
              <DropdownMenuItem
                aria-keyshortcuts={shortcuts.delete.keys}
                onSelect={() => onAction("delete")}
                variant="destructive"
              >
                <Trash2 />
                Move to Trash
                <DropdownMenuShortcut aria-hidden>
                  {shortcuts.delete.label}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
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
