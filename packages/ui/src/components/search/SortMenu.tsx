import type { CardListSort } from "@teak/convex/shared";
import { Button } from "@teak/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@teak/ui/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@teak/ui/components/ui/tooltip";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Dices,
  FolderSearch,
  Shuffle,
} from "lucide-react";
import { cn } from "../../lib/utils";

export const SORT_LABELS: Record<CardListSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  shuffle: "Shuffle",
};

const SORT_ICONS = {
  newest: ArrowDownWideNarrow,
  oldest: ArrowUpNarrowWide,
  shuffle: Shuffle,
} satisfies Record<CardListSort, unknown>;

interface SortMenuProps {
  /** Offers "Save as smart folder…" under the sort options. */
  onSaveSearch?: () => void;
  onSortChange: (sort: CardListSort) => void;
  sort: CardListSort;
}

/**
 * A quiet icon button that orders the library by saved date, or shuffles
 * it. A non-default order tints the icon so it is noticeable at a glance.
 * While there is a search to keep, it also saves it as a smart folder.
 */
export function SortMenu({ sort, onSaveSearch, onSortChange }: SortMenuProps) {
  const Icon = SORT_ICONS[sort];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={
            onSaveSearch
              ? `Sort and save search: ${SORT_LABELS[sort]}`
              : `Sort: ${SORT_LABELS[sort]}`
          }
          size="icon"
          type="button"
          variant="ghost"
        >
          <Icon
            className={cn(
              "size-4 transition-colors duration-150",
              sort !== "newest" && "text-primary"
            )}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="font-normal text-muted-foreground text-xs">
          Sort cards
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          onValueChange={(value) => onSortChange(value as CardListSort)}
          value={sort}
        >
          <DropdownMenuRadioItem value="newest">
            {SORT_LABELS.newest}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="oldest">
            {SORT_LABELS.oldest}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="shuffle">
            {SORT_LABELS.shuffle}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {onSaveSearch && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onSaveSearch}>
              <FolderSearch />
              Save as smart folder…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Shown next to the sort menu while shuffling: a new seed, a new order. The
 * old order stays one Back away.
 */
export function ReshuffleButton({ onReshuffle }: { onReshuffle: () => void }) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="Reshuffle"
            onClick={onReshuffle}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Dices className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reshuffle</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
