import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Hash,
  Heart,
  Trash2,
  CreditCard,
  FileText,
  Link,
  Image,
  Video,
  Volume2,
  File,
} from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import {
  type TypeaheadOption,
  type CardType,
  CARD_TYPE_LABELS,
  RESERVED_KEYWORDS,
} from "@teak/shared/constants";
import SubscriptionPage from "./SubscriptionPage";

interface SearchBarProps {
  searchQuery: string;
  onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  showTypeahead: boolean;
  onTypeaheadSelect: (option: TypeaheadOption) => void;
  onTypeaheadClose: () => void;
  typeaheadSelectedIndex: number;
  setTypeaheadSelectedIndex: (index: number) => void;
  keywordTags: string[];
  filterTags: CardType[];
  showFavoritesOnly: boolean;
  showTrashOnly: boolean;
  onRemoveKeyword: (keyword: string) => void;
  onRemoveFilter: (filter: CardType) => void;
  onRemoveFavorites: () => void;
  onRemoveTrash: () => void;
  onClearAll: () => void;
}

// Icon mapping for typeahead options
const getOptionIcon = (value: string) => {
  switch (value) {
    case "text":
      return FileText;
    case "link":
      return Link;
    case "image":
      return Image;
    case "video":
      return Video;
    case "audio":
      return Volume2;
    case "document":
      return File;
    case "favorites":
      return Heart;
    case "trash":
      return Trash2;
    default:
      return FileText;
  }
};

export function SearchBar({
  searchQuery,
  onSearchChange,
  onKeyDown,
  onTypeaheadSelect,
  keywordTags,
  filterTags,
  showFavoritesOnly,
  showTrashOnly,
  onRemoveKeyword,
  onRemoveFilter,
  onRemoveFavorites,
  onRemoveTrash,
  onClearAll,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  const hasAnyTags =
    keywordTags.length > 0 ||
    filterTags.length > 0 ||
    showFavoritesOnly ||
    showTrashOnly;

  // Create arrays for selected and available filters
  const selectedKeywords = keywordTags;
  const selectedFilters = filterTags;

  // Get available (unselected) filters - exclude already selected ones
  const availableOptions = RESERVED_KEYWORDS.filter((option) => {
    // Exclude selected card type filters
    if (selectedFilters.includes(option.value as CardType)) {
      return false;
    }
    // Exclude favorites if already selected
    if (option.value === "favorites" && showFavoritesOnly) {
      return false;
    }
    // Exclude trash if already selected
    if (option.value === "trash" && showTrashOnly) {
      return false;
    }
    return true;
  });

  // Show filters when focused or when there are active filters
  const shouldShowFilters = isFocused || hasAnyTags;

  // Handle keyboard for adding keywords
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Let the shared hook handle all keyboard logic (including Enter for keywords)
    onKeyDown(e);
  };

  return (
    <div className="bg-background">
      <div className="flex items-center group">
        <div className="flex items-center gap-2">
          <Search className="text-muted-foreground size-4 group-focus-within:text-primary group-focus-within:stroke-[2.5] group-hover:text-primary group-hover:stroke-[2.5]" />
        </div>

        <div className="relative flex-1">
          <Input
            ref={inputRef}
            type="search"
            placeholder="Search for anything..."
            value={searchQuery}
            onChange={onSearchChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            className="border-0 focus-visible:outline-none focus-visible:ring-0 h-16 rounded-none"
            autoCapitalize="off"
            autoCorrect="off"
          />
        </div>

        <UserButton>
          <UserButton.UserProfilePage
            label="Subscription"
            url="subscription"
            labelIcon={<CreditCard className="size-3.5 stroke-3 mt-0.5" />}
          >
            <SubscriptionPage />
          </UserButton.UserProfilePage>
        </UserButton>
      </div>

      {/* Filter section with new ordering */}
      {shouldShowFilters && (
        <div
          className="pb-4 animate-in slide-in-from-top-2 fade-in-0 duration-200"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="flex flex-wrap gap-2">
            {/* Selected keywords first */}
            {selectedKeywords.map((keyword) => (
              <Badge
                key={`keyword-${keyword}`}
                variant="default"
                className="cursor-pointer"
                asChild
              >
                <button
                  type="button"
                  onClick={() => onRemoveKeyword(keyword)}
                  className="flex items-center gap-1"
                >
                  <Hash />
                  <span>{keyword}</span>
                </button>
              </Badge>
            ))}

            {/* Selected filters second */}
            {selectedFilters.map((filter) => {
              const IconComponent = getOptionIcon(filter);
              return (
                <Badge
                  key={`filter-${filter}`}
                  variant="default"
                  className="cursor-pointer"
                  asChild
                >
                  <button
                    type="button"
                    onClick={() => onRemoveFilter(filter)}
                    className="flex items-center gap-1"
                  >
                    <IconComponent className="size-3" />
                    <span>{CARD_TYPE_LABELS[filter]}</span>
                  </button>
                </Badge>
              );
            })}

            {/* Selected special filters */}
            {showFavoritesOnly && (
              <Badge variant="default" className="cursor-pointer" asChild>
                <button
                  type="button"
                  onClick={onRemoveFavorites}
                  className="flex items-center gap-1"
                >
                  <Heart className="size-3" />
                  <span>Favorites</span>
                </button>
              </Badge>
            )}

            {showTrashOnly && (
              <Badge variant="default" className="cursor-pointer" asChild>
                <button
                  type="button"
                  onClick={onRemoveTrash}
                  className="flex items-center gap-1"
                >
                  <Trash2 className="size-3" />
                  <span>Trash</span>
                </button>
              </Badge>
            )}

            {/* Available (unselected) filters */}
            {availableOptions.map((option) => {
              const IconComponent = getOptionIcon(option.value);
              return (
                <Badge
                  key={`available-${option.value}`}
                  variant="outline"
                  className="cursor-pointer"
                  asChild
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onTypeaheadSelect(option);
                    }}
                  >
                    <IconComponent />
                    <span>{option.label}</span>
                  </button>
                </Badge>
              );
            })}

            {/* Clear all badge (only if there are selections) */}
            {hasAnyTags && (
              <Badge variant="outline" className="cursor-pointer" asChild>
                <button type="button" onClick={onClearAll}>
                  Clear All
                </button>
              </Badge>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
