import { Button } from "@teak/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@teak/ui/components/ui/dropdown-menu";
import { Kbd } from "@teak/ui/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@teak/ui/components/ui/tooltip";
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

  // A strip across the top of the content column (beside the sidebar), like
  // the toasts at the bottom, so the two never cover each other.
  return (
    <div className="fade-in-0 slide-in-from-top-2 fixed top-0 right-0 left-(--teak-content-left) z-50 animate-in border-b bg-background/95 pt-[env(safe-area-inset-top)] shadow-sm backdrop-blur transition-[left] duration-150 ease-out">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4">
        <span
          aria-live="polite"
          className="mr-auto truncate font-medium text-sm tabular-nums"
        >
          {addToFolder && selectedCount === 0
            ? "Choose cards to add"
            : `${cardCountLabel(selectedCount)} selected`}
        </span>
        <Button
          className="max-w-[55%]"
          disabled={disabled}
          onClick={() => onAction(primary.action)}
          size="sm"
          title={primary.label}
        >
          <PrimaryIcon />
          <span className="truncate">{primary.label}</span>
        </Button>
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
              <DropdownMenuItem onSelect={() => onAction("favorite")}>
                <Heart />
                Add to favorites
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction("unfavorite")}>
                <HeartOff />
                Remove from favorites
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onAction("addTags")}>
                <Tag />
                Add tags…
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
                onSelect={() => onAction("delete")}
                variant="destructive"
              >
                <Trash2 />
                Move to Trash
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
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
            </TooltipTrigger>
            <TooltipContent className="flex items-center gap-2" side="bottom">
              Cancel selection
              <Kbd>Esc</Kbd>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
