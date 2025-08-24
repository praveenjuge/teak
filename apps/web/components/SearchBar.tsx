import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Hash,
  Heart,
  Trash2,
  X,
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
  setTypeaheadSelectedIndex,
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

  // Always show all options when focused or typing, don't filter them
  const filteredOptions = RESERVED_KEYWORDS;

  // Show pills when focused or has active filters
  const shouldShowPills = isFocused || hasAnyTags;

  // Handle keyboard for adding keywords
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Let the shared hook handle all keyboard logic (including Enter for keywords)
    onKeyDown(e);
  };

  return (
    <div className="bg-background">
      <div className="flex items-center group">
        <div className="flex items-center gap-2">
          <Search className="text-muted-foreground size-4 group-focus-within:text-primary group-focus-within:stroke-[2.5]" />

          {keywordTags.map((keyword) => (
            <Badge
              key={keyword}
              variant="outline"
              className="flex items-center gap-1"
            >
              <Hash className="size-3" />
              <span>{keyword}</span>
              <Button
                size="icon"
                variant="ghost"
                className="size-4 p-0"
                onClick={() => onRemoveKeyword(keyword)}
              >
                <X className="size-3" />
              </Button>
            </Badge>
          ))}

          {filterTags.map((filter) => {
            const IconComponent = getOptionIcon(filter);
            return (
              <Badge
                key={filter}
                variant="outline"
                className="flex items-center gap-1"
              >
                <IconComponent className="size-3" />
                <span>{CARD_TYPE_LABELS[filter]}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-4 p-0"
                  onClick={() => onRemoveFilter(filter)}
                >
                  <X className="size-3" />
                </Button>
              </Badge>
            );
          })}

          {showFavoritesOnly && (
            <Badge variant="outline" className="flex items-center gap-1">
              <Heart className="size-3" />
              <span>Favorites</span>
              <Button
                size="icon"
                variant="ghost"
                className="size-4 p-0"
                onClick={onRemoveFavorites}
              >
                <X className="size-3" />
              </Button>
            </Badge>
          )}

          {showTrashOnly && (
            <Badge variant="outline" className="flex items-center gap-1">
              <Trash2 className="size-3" />
              <span>Trash</span>
              <Button
                size="icon"
                variant="ghost"
                className="size-4 p-0"
                onClick={onRemoveTrash}
              >
                <X className="size-3" />
              </Button>
            </Badge>
          )}
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

        {hasAnyTags && (
          <Button
            size="sm"
            variant="outline"
            onClick={onClearAll}
            className="mr-3"
          >
            Clear
          </Button>
        )}

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

      {/* Search suggestions pills */}
      {shouldShowPills && (
        <div
          className="pb-4 animate-in slide-in-from-top-2 fade-in-0 duration-200"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="flex flex-wrap gap-2">
            {filteredOptions.map((option, index) => {
              const IconComponent = getOptionIcon(option.value);
              return (
                <Badge
                  key={option.value}
                  variant="outline"
                  className="cursor-pointer hover:bg-accent transition-colors"
                  asChild
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onTypeaheadSelect(option);
                    }}
                    onMouseEnter={() => setTypeaheadSelectedIndex(index)}
                  >
                    <IconComponent />
                    <span>
                      {option.value === "favorites" ? "Show" : "Filter"}:
                    </span>
                    <span>{option.label}</span>
                  </button>
                </Badge>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
