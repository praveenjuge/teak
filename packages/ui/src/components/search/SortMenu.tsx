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
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  FolderSearch,
} from "lucide-react";
import { cn } from "../../lib/utils";

export const SORT_LABELS: Record<CardListSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
};

interface SortMenuProps {
  /** Offers "Save as smart folder…" under the sort options. */
  onSaveSearch?: () => void;
  onSortChange: (sort: CardListSort) => void;
  sort: CardListSort;
}

/**
 * A quiet icon button that orders the library by saved date. Oldest first
 * tints the icon so a non-default order is noticeable at a glance. While
 * there is a search to keep, it also saves it as a smart folder.
 */
export function SortMenu({ sort, onSaveSearch, onSortChange }: SortMenuProps) {
  const Icon = sort === "oldest" ? ArrowUpNarrowWide : ArrowDownWideNarrow;
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
              sort === "oldest" && "text-primary"
            )}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="font-normal text-muted-foreground text-xs">
          Sort by date saved
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
