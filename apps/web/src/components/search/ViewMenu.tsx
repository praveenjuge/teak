import { type CardType, cardTypes } from "@teak/convex/shared/constants";
import {
  createTeakTranslator,
  englishMessages,
  type TeakTranslator,
} from "@teak/i18n";
import { useTranslations } from "@teak/i18n/react";
import {
  Dices,
  File,
  FileText,
  FolderSearch,
  Image,
  Layers,
  Link as LinkIcon,
  Palette,
  Quote,
  SlidersHorizontal,
  type VadivamIcon,
  Video,
  Volume2,
} from "vadivam-react";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { LibrarySort } from "../../lib/searchUrlState";
import { cn } from "../../lib/utils";
import {
  type CardTypesTranslator,
  englishCardTypes,
} from "../cards/cardTypeLabel";

const englishSearch = createTeakTranslator("en", englishMessages, "search");

const TYPE_ICONS: Record<CardType, VadivamIcon> = {
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
  activeTypes: readonly CardType[];
  canSortByRelevance?: boolean;
  onClearTypes?: () => void;
  onSaveSearch?: () => void;
  onSortChange?: (sort: LibrarySort) => void;
  onToggleType?: (type: CardType) => void;
  revisit?: "empty" | "ready";
  sort?: LibrarySort;
}

export const viewMenuLabel = (
  activeTypes: readonly CardType[],
  sort: LibrarySort = "newest",
  t: TeakTranslator<"search"> = englishSearch,
  types: CardTypesTranslator = englishCardTypes
): string => {
  const parts = activeTypes.map((type) => types(type));
  if (sort === "oldest") {
    parts.push(t("viewMenu.oldestFirstState"));
  } else if (sort === "shuffle") {
    parts.push(t("viewMenu.shuffledState"));
  } else if (sort === "revisit") {
    parts.push(t("viewMenu.revisitingState"));
  }
  return parts.length > 0
    ? t("viewMenu.labelWithState", { state: parts.join(", ") })
    : t("viewMenu.label");
};

export function ViewMenu({
  activeTypes,
  canSortByRelevance = false,
  onClearTypes,
  onSaveSearch,
  onSortChange,
  onToggleType,
  revisit,
  sort = "newest",
}: ViewMenuProps) {
  const t = useTranslations("search");
  const types = useTranslations("cards.types");
  const count = activeTypes.length;
  const changedOrder = sort !== "newest" && sort !== "relevance";
  const changed = count > 0 || changedOrder;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={viewMenuLabel(activeTypes, sort, t, types)}
          className="relative h-9 shrink-0 gap-1.5 px-2.5 font-normal text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground max-lg:w-9 max-lg:px-0"
          type="button"
          variant="ghost"
        >
          <SlidersHorizontal
            className={cn("size-4", changed && "text-primary")}
          />
          <span aria-hidden="true" className="max-lg:hidden">
            {t("viewMenu.label")}
          </span>
          {count > 0 && (
            <span
              aria-hidden="true"
              className="flex size-4 items-center justify-center rounded-full bg-primary font-semibold text-[10px] text-primary-foreground tabular-nums max-lg:absolute max-lg:top-1 max-lg:right-1 max-lg:size-3.5 max-lg:text-[9px]"
            >
              {count}
            </span>
          )}
          {count === 0 && changedOrder && (
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-primary max-lg:absolute max-lg:top-2 max-lg:right-2"
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {onToggleType ? (
          <>
            <DropdownMenuLabel className="font-normal text-muted-foreground text-xs">
              {t("viewMenu.show")}
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
                  {types(type)}
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
                {t("viewMenu.showAllTypes")}
              </DropdownMenuItem>
            )}
          </>
        ) : null}
        {onSortChange ? (
          <>
            {onToggleType ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="font-normal text-muted-foreground text-xs">
              {t("viewMenu.sort")}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              onValueChange={(value) => onSortChange(value as LibrarySort)}
              value={sort}
            >
              {canSortByRelevance ? (
                <DropdownMenuRadioItem value="relevance">
                  {t("viewMenu.sorts.relevance")}
                </DropdownMenuRadioItem>
              ) : null}
              <DropdownMenuRadioItem value="newest">
                {t("viewMenu.sorts.newest")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="oldest">
                {t("viewMenu.sorts.oldest")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="shuffle">
                {t("viewMenu.sorts.shuffle")}
              </DropdownMenuRadioItem>
              {revisit ? (
                <DropdownMenuRadioItem
                  className="flex-wrap"
                  disabled={revisit === "empty"}
                  value="revisit"
                >
                  {t("viewMenu.sorts.revisit")}
                  <Layers className="ml-auto text-muted-foreground" />
                  {revisit === "empty" && (
                    <span className="w-full text-muted-foreground text-xs">
                      {t("viewMenu.nothingToRevisit")}
                    </span>
                  )}
                </DropdownMenuRadioItem>
              ) : null}
            </DropdownMenuRadioGroup>
          </>
        ) : null}
        {onSaveSearch ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onSaveSearch}>
              <FolderSearch />
              {t("viewMenu.saveAsSmartFolder")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ReshuffleButton({ onReshuffle }: { onReshuffle: () => void }) {
  const t = useTranslations("search.viewMenu");
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={t("reshuffle")}
            className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onReshuffle}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Dices className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("reshuffle")}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
