import type { CardListSort } from "@teak/convex/shared";
import {
  CARD_TYPE_LABELS,
  type CardType,
  cardTypes,
} from "@teak/convex/shared/constants";
import { Button } from "@teak/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
  Dices,
  File,
  FileText,
  FolderSearch,
  Image,
  Link as LinkIcon,
  type LucideIcon,
  Palette,
  Quote,
  SlidersHorizontal,
  Video,
  Volume2,
} from "lucide-react";
import { cn } from "../../lib/utils";

export const SORT_LABELS: Record<CardListSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  shuffle: "Shuffle",
};

const TYPE_ICONS: Record<CardType, LucideIcon> = {
  text: FileText,
  link: LinkIcon,
  image: Image,
  video: Video,
  audio: Volume2,
  document: File,
  palette: Palette,
  quote: Quote,
};

interface ViewMenuProps {
  /** Card types narrowing the results, shown checked. */
  activeTypes: readonly CardType[];
  onClearTypes?: () => void;
  /** Offers "Save as smart folder…" while there is a search to keep. */
  onSaveSearch?: () => void;
  /** Shows the Sort section when set. */
  onSortChange?: (sort: CardListSort) => void;
  /** Shows the card type section when set. */
  onToggleType?: (type: CardType) => void;
  sort?: CardListSort;
}

/**
 * What the View button reads as: "View: Link, Image, oldest first" (or
 * "shuffled").
 */
export const viewMenuLabel = (
  activeTypes: readonly CardType[],
  sort: CardListSort = "newest"
): string => {
  const parts = activeTypes.map((type) => CARD_TYPE_LABELS[type]);
  if (sort === "oldest") {
    parts.push("oldest first");
  } else if (sort === "shuffle") {
    parts.push("shuffled");
  }
  return parts.length > 0 ? `View: ${parts.join(", ")}` : "View";
};

/**
 * One quiet button for how the library is shown: which card types (pick
 * several; the menu stays open while you pick), the order, and saving the
 * search as a smart folder. A count (or a dot, for a changed order) shows
 * when the view differs from the default.
 */
export function ViewMenu({
  activeTypes,
  onClearTypes,
  onSaveSearch,
  onSortChange,
  onToggleType,
  sort = "newest",
}: ViewMenuProps) {
  const count = activeTypes.length;
  const changed = count > 0 || sort !== "newest";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={viewMenuLabel(activeTypes, sort)}
          className="relative size-9 shrink-0 text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
          size="icon"
          type="button"
          variant="ghost"
        >
          <SlidersHorizontal
            className={cn("size-4", changed && "text-primary")}
          />
          {count > 0 && (
            <span
              aria-hidden="true"
              className="absolute top-1 right-1 flex size-3.5 items-center justify-center rounded-full bg-primary font-semibold text-[9px] text-primary-foreground tabular-nums"
            >
              {count}
            </span>
          )}
          {count === 0 && sort !== "newest" && (
            <span
              aria-hidden="true"
              className="absolute top-2 right-2 size-1.5 rounded-full bg-primary"
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {onToggleType && (
          <>
            <DropdownMenuLabel className="font-normal text-muted-foreground text-xs">
              Show
            </DropdownMenuLabel>
            {cardTypes.map((type) => {
              const Icon = TYPE_ICONS[type];
              return (
                <DropdownMenuCheckboxItem
                  checked={activeTypes.includes(type)}
                  key={type}
                  onSelect={(event) => {
                    event.preventDefault();
                    onToggleType(type);
                  }}
                >
                  <Icon className="text-muted-foreground" />
                  {CARD_TYPE_LABELS[type]}
                </DropdownMenuCheckboxItem>
              );
            })}
            {count > 0 && onClearTypes && (
              <DropdownMenuItem
                className="text-muted-foreground"
                onSelect={(event) => {
                  event.preventDefault();
                  onClearTypes();
                }}
              >
                Show all types
              </DropdownMenuItem>
            )}
          </>
        )}
        {onSortChange && (
          <>
            {onToggleType && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="font-normal text-muted-foreground text-xs">
              Sort
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
          </>
        )}
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
 * Shown beside the View menu while shuffling: a new seed, a new order. The
 * old order stays one Back away.
 */
export function ReshuffleButton({ onReshuffle }: { onReshuffle: () => void }) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="Reshuffle"
            className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
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
