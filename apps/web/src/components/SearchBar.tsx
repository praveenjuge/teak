import type {
  CardType,
  ColorHueBucket,
  TimeFilter,
  VisualStyle,
} from "@teak/convex/shared";
import { buttonVariants } from "@teak/ui/components/ui/button";
import { SearchBar as SharedSearchBar } from "@teak/ui/search";
import { Settings } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  filterTags: CardType[];
  hexFilters: string[];
  hueFilters: ColorHueBucket[];
  keywordTags: string[];
  onAddFilter: (filter: CardType) => void;
  onClearAll: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onRemoveFilter: (filter: CardType) => void;
  onRemoveHexFilter: (hex: string) => void;
  onRemoveHueFilter: (hue: ColorHueBucket) => void;
  onRemoveKeyword: (keyword: string) => void;
  onRemoveStyleFilter: (style: VisualStyle) => void;
  onRemoveTimeFilter: () => void;
  onSearchChange: (value: string) => void;
  onToggleFavorites: () => void;
  onToggleTrash: () => void;
  searchQuery: string;
  showFavoritesOnly: boolean;
  showTrashOnly: boolean;
  styleFilters: VisualStyle[];
  timeFilter?: TimeFilter | null;
}

export function SearchBar({
  searchQuery,
  onSearchChange,
  onKeyDown,
  keywordTags,
  timeFilter,
  filterTags,
  styleFilters,
  hueFilters,
  hexFilters,
  showFavoritesOnly,
  showTrashOnly,
  onAddFilter,
  onRemoveFilter,
  onRemoveStyleFilter,
  onRemoveHueFilter,
  onRemoveHexFilter,
  onRemoveKeyword,
  onRemoveTimeFilter,
  onToggleFavorites,
  onToggleTrash,
  onClearAll,
}: SearchBarProps) {
  const settingsButton = (
    <Link
      className={cn(
        buttonVariants({
          variant: "outline",
          size: "icon",
        })
      )}
      href="/settings"
    >
      <Settings />
    </Link>
  );

  return (
    <SharedSearchBar
      filterTags={filterTags}
      hexFilters={hexFilters}
      hueFilters={hueFilters}
      keywordTags={keywordTags}
      onAddFilter={onAddFilter}
      onClearAll={onClearAll}
      onKeyDown={onKeyDown}
      onRemoveFilter={onRemoveFilter}
      onRemoveHexFilter={onRemoveHexFilter}
      onRemoveHueFilter={onRemoveHueFilter}
      onRemoveKeyword={onRemoveKeyword}
      onRemoveStyleFilter={onRemoveStyleFilter}
      onRemoveTimeFilter={onRemoveTimeFilter}
      onSearchChange={onSearchChange}
      onToggleFavorites={onToggleFavorites}
      onToggleTrash={onToggleTrash}
      SettingsButton={settingsButton}
      searchQuery={searchQuery}
      showFavoritesOnly={showFavoritesOnly}
      showTrashOnly={showTrashOnly}
      styleFilters={styleFilters}
      timeFilter={timeFilter}
    />
  );
}
