import {
  CARD_TYPE_LABELS,
  type CardType,
  cardTypes,
  getCardTypeIcon,
} from "@teak/convex/shared/constants";
import {
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
  Trash2,
  Video,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  keywordTags: string[];
  filterTags: CardType[];
  showFavoritesOnly: boolean;
  showTrashOnly: boolean;
  onAddFilter: (filter: CardType) => void;
  onRemoveFilter: (filter: CardType) => void;
  onRemoveKeyword: (keyword: string) => void;
  onToggleFavorites: () => void;
  onToggleTrash: () => void;
  onClearAll: () => void;
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
  filterTags,
  showFavoritesOnly,
  showTrashOnly,
  onAddFilter,
  onRemoveFilter,
  onRemoveKeyword,
  onToggleFavorites,
  onToggleTrash,
  onClearAll,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  const hasAnyFilters =
    keywordTags.length > 0 ||
    filterTags.length > 0 ||
    showFavoritesOnly ||
    showTrashOnly;
  const shouldShowFilters = isFocused || hasAnyFilters;

  const availableFilters = cardTypes.filter(
    (type) => !filterTags.includes(type)
  );

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
                size="sm"
                variant="default"
              >
                <Hash className="size-3.5 stroke-2" />
                <span>{keyword}</span>
              </Button>
            ))}

            {/* Active filters */}
            {filterTags.map((filter) => {
              const IconComponent = getFilterIcon(filter);
              return (
                <Button
                  key={`filter-${filter}`}
                  onClick={() => onRemoveFilter(filter)}
                  size="sm"
                  variant="default"
                >
                  <IconComponent className="size-3.5 stroke-2" />
                  <span>{CARD_TYPE_LABELS[filter]}</span>
                </Button>
              );
            })}

            {showFavoritesOnly && (
              <Button onClick={onToggleFavorites} size="sm" variant="default">
                <Heart className="size-3.5 stroke-2" />
                <span>Favorites</span>
              </Button>
            )}

            {showTrashOnly && (
              <Button onClick={onToggleTrash} size="sm" variant="default">
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
                  size="sm"
                  variant="outline"
                >
                  <IconComponent className="size-3.5 stroke-2" />
                  <span>{CARD_TYPE_LABELS[filter]}</span>
                </Button>
              );
            })}

            {!showFavoritesOnly && (
              <Button onClick={onToggleFavorites} size="sm" variant="outline">
                <Heart className="size-3.5 stroke-2" />
                <span>Favorites</span>
              </Button>
            )}

            {!showTrashOnly && (
              <Button onClick={onToggleTrash} size="sm" variant="outline">
                <Trash2 className="size-3.5 stroke-2" />
                <span>Trash</span>
              </Button>
            )}

            {hasAnyFilters && (
              <Button onClick={onClearAll} size="sm" variant="outline">
                Clear All
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
