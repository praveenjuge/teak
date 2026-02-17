import type { TimeFilter } from "@teak/convex/shared";
import {
  CARD_TYPE_LABELS,
  type CardType,
  COLOR_HUE_LABELS,
  type ColorHueBucket,
  cardTypes,
  getCardTypeIcon,
  VISUAL_STYLE_LABELS,
  type VisualStyle,
} from "@teak/convex/shared/constants";
import { Button, buttonVariants } from "@teak/ui/components/ui/button";
import { Input } from "@teak/ui/components/ui/input";
import {
  Clock,
  Droplets,
  File,
  FileText,
  Hash,
  Heart,
  Image,
  Link as LinkIcon,
  Palette,
  Quote,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Video,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
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

// Icon component mapping for Lucide React icons
const iconComponentMap = {
  FileText,
  Link: LinkIcon,
  Image,
  Video,
  Volume2,
  File,
  Palette,
  Quote,
} as const;

const getFilterIcon = (filter: CardType) => {
  const iconName = getCardTypeIcon(filter) as keyof typeof iconComponentMap;
  return iconComponentMap[iconName] || FileText;
};

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
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  const hasAnyFilters =
    keywordTags.length > 0 ||
    Boolean(timeFilter) ||
    filterTags.length > 0 ||
    styleFilters.length > 0 ||
    hueFilters.length > 0 ||
    hexFilters.length > 0 ||
    showFavoritesOnly ||
    showTrashOnly;
  const shouldShowFilters =
    isFocused || hasAnyFilters || searchQuery.length > 0;

  const availableFilters = cardTypes.filter(
    (type) => !filterTags.includes(type)
  );

  const preventBlur = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  return (
    <>
      <div className="group flex items-center">
        <div className="flex items-center gap-2">
          <Search className="size-4 text-muted-foreground group-focus-within:stroke-[2.5] group-focus-within:text-primary group-hover:stroke-[2.5] group-hover:text-primary" />
        </div>

        <div className="relative flex-1">
          <Input
            autoCapitalize="off"
            autoCorrect="off"
            className="h-16 rounded-none border-0 bg-transparent focus-visible:outline-none focus-visible:ring-0 dark:bg-transparent"
            onBlur={() => setIsFocused(false)}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onKeyDown={onKeyDown}
            placeholder="Search for anything..."
            ref={inputRef}
            type="search"
            value={searchQuery}
          />
        </div>

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
      </div>
      {shouldShowFilters && (
        <div className="slide-in-from-top-2 fade-in-0 animate-in pb-5 duration-200">
          <div className="flex flex-wrap gap-2">
            {/* Keyword tags */}
            {keywordTags.map((keyword) => (
              <Button
                key={`keyword-${keyword}`}
                onClick={() => onRemoveKeyword(keyword)}
                onMouseDown={preventBlur}
                size="sm"
                variant="default"
              >
                <Hash className="size-3.5 stroke-2" />
                <span>{keyword}</span>
              </Button>
            ))}

            {timeFilter && (
              <Button
                key="time-filter"
                onClick={onRemoveTimeFilter}
                onMouseDown={preventBlur}
                size="sm"
                variant="default"
              >
                <Clock className="size-3.5 stroke-2" />
                <span>{timeFilter.label}</span>
              </Button>
            )}

            {/* Active filters */}
            {filterTags.map((filter) => {
              const IconComponent = getFilterIcon(filter);
              return (
                <Button
                  key={`filter-${filter}`}
                  onClick={() => onRemoveFilter(filter)}
                  onMouseDown={preventBlur}
                  size="sm"
                  variant="default"
                >
                  <IconComponent className="size-3.5 stroke-2" />
                  <span>{CARD_TYPE_LABELS[filter]}</span>
                </Button>
              );
            })}

            {styleFilters.map((style) => (
              <Button
                key={`style-${style}`}
                onClick={() => onRemoveStyleFilter(style)}
                onMouseDown={preventBlur}
                size="sm"
                variant="default"
              >
                <Sparkles className="size-3.5 stroke-2" />
                <span>{VISUAL_STYLE_LABELS[style]}</span>
              </Button>
            ))}

            {hueFilters.map((hue) => (
              <Button
                key={`hue-${hue}`}
                onClick={() => onRemoveHueFilter(hue)}
                onMouseDown={preventBlur}
                size="sm"
                variant="default"
              >
                <Droplets className="size-3.5 stroke-2" />
                <span>{COLOR_HUE_LABELS[hue]}</span>
              </Button>
            ))}

            {hexFilters.map((hex) => (
              <Button
                key={`hex-${hex}`}
                onClick={() => onRemoveHexFilter(hex)}
                onMouseDown={preventBlur}
                size="sm"
                variant="default"
              >
                <span
                  className="size-3 rounded-full border"
                  style={{ backgroundColor: hex }}
                />
                <span>{hex}</span>
              </Button>
            ))}

            {showFavoritesOnly && (
              <Button
                onClick={onToggleFavorites}
                onMouseDown={preventBlur}
                size="sm"
                variant="default"
              >
                <Heart className="size-3.5 stroke-2" />
                <span>Favorites</span>
              </Button>
            )}

            {showTrashOnly && (
              <Button
                onClick={onToggleTrash}
                onMouseDown={preventBlur}
                size="sm"
                variant="default"
              >
                <Trash2 className="size-3.5 stroke-2" />
                <span>Trash</span>
              </Button>
            )}

            {/* Available filters */}
            {availableFilters.map((filter) => {
              const IconComponent = getFilterIcon(filter);
              return (
                <Button
                  key={`available-${filter}`}
                  onClick={() => onAddFilter(filter)}
                  onMouseDown={preventBlur}
                  size="sm"
                  variant="outline"
                >
                  <IconComponent className="size-3.5 stroke-2" />
                  <span>{CARD_TYPE_LABELS[filter]}</span>
                </Button>
              );
            })}

            {!showFavoritesOnly && (
              <Button
                onClick={onToggleFavorites}
                onMouseDown={preventBlur}
                size="sm"
                variant="outline"
              >
                <Heart className="size-3.5 stroke-2" />
                <span>Favorites</span>
              </Button>
            )}

            {!showTrashOnly && (
              <Button
                onClick={onToggleTrash}
                onMouseDown={preventBlur}
                size="sm"
                variant="outline"
              >
                <Trash2 className="size-3.5 stroke-2" />
                <span>Trash</span>
              </Button>
            )}

            {(hasAnyFilters || searchQuery.length > 0) && (
              <Button
                onClick={onClearAll}
                onMouseDown={preventBlur}
                size="sm"
                variant="outline"
              >
                Clear All
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
