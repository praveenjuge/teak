import { Button } from "@teak/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@teak/ui/components/ui/dropdown-menu";
import {
  Archive,
  ArchiveRestore,
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

interface BulkActionBarProps {
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
  selectedCount,
  onAction,
  onCancel,
  view = "library",
  isBusy = false,
}: BulkActionBarProps) {
  const primary = PRIMARY[view];
  const PrimaryIcon = primary.icon;
  const disabled = selectedCount === 0 || isBusy;

  // A strip across the top of the content column (beside the sidebar), like
  // the toasts at the bottom, so the two never cover each other.
  return (
    <div className="fade-in-0 slide-in-from-top-2 fixed top-0 right-0 left-(--teak-content-left) z-50 animate-in border-b bg-background/95 pt-[env(safe-area-inset-top)] shadow-sm backdrop-blur transition-[left] duration-200">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4">
        <span
          aria-live="polite"
          className="mr-auto truncate font-medium text-sm tabular-nums"
        >
          {cardCountLabel(selectedCount)} selected
        </span>
        <Button
          disabled={disabled}
          onClick={() => onAction(primary.action)}
          size="sm"
        >
          <PrimaryIcon />
          {primary.label}
        </Button>
        {view !== "trash" && (
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
        <Button
          aria-label="Cancel selection"
          className="size-8"
          onClick={onCancel}
          size="icon"
          variant="ghost"
        >
          <X />
        </Button>
      </div>
    </div>
  );
}
