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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@teak/ui/components/ui/dropdown-menu";
import {
  File,
  FileText,
  Image,
  Link as LinkIcon,
  ListFilter,
  type LucideIcon,
  Palette,
  Quote,
  Video,
  Volume2,
} from "lucide-react";
import { cn } from "../../lib/utils";

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

interface TypeFilterMenuProps {
  /** Card types narrowing the results, shown checked. */
  activeTypes: readonly CardType[];
  onClear: () => void;
  onToggle: (type: CardType) => void;
}

/**
 * A quiet icon button that narrows the library to card types. Several can
 * be picked (the menu stays open while you pick); the icon tints and shows
 * how many are on, and each picked type also shows as a chip under the
 * search.
 */
export function TypeFilterMenu({
  activeTypes,
  onClear,
  onToggle,
}: TypeFilterMenuProps) {
  const count = activeTypes.length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={
            count > 0
              ? `Card types: ${activeTypes.map((type) => CARD_TYPE_LABELS[type]).join(", ")}`
              : "Card types"
          }
          className="relative"
          size="icon"
          type="button"
          variant="ghost"
        >
          <ListFilter
            className={cn(
              "size-4 transition-colors duration-150",
              count > 0 && "text-primary"
            )}
          />
          {count > 0 && (
            <span
              aria-hidden="true"
              className="absolute top-1 right-1 flex size-3.5 items-center justify-center rounded-full bg-primary font-semibold text-[9px] text-primary-foreground tabular-nums"
            >
              {count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="font-normal text-muted-foreground text-xs">
          Show only
        </DropdownMenuLabel>
        {cardTypes.map((type) => {
          const Icon = TYPE_ICONS[type];
          return (
            <DropdownMenuCheckboxItem
              checked={activeTypes.includes(type)}
              key={type}
              onSelect={(event) => {
                // Keep the menu open to pick several.
                event.preventDefault();
                onToggle(type);
              }}
            >
              <Icon className="text-muted-foreground" />
              {CARD_TYPE_LABELS[type]}
            </DropdownMenuCheckboxItem>
          );
        })}
        {count > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onClear}>
              Show all types
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
