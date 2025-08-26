import { Suspense, useRef, useState } from "react";
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
  Moon,
  Palette,
} from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { type CardType, CARD_TYPE_LABELS } from "@teak/shared/constants";
import SubscriptionPage from "./SubscriptionPage";
import { useTheme } from "next-themes";

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

const getFilterIcon = (filter: CardType) => {
  switch (filter) {
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
    case "palette":
      return Palette;
    default:
      return FileText;
  }
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
  const { setTheme, theme } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  const hasAnyFilters =
    keywordTags.length > 0 ||
    filterTags.length > 0 ||
    showFavoritesOnly ||
    showTrashOnly;
  const shouldShowFilters = isFocused || hasAnyFilters;

  const availableCardTypes: CardType[] = [
    "text",
    "link",
    "image",
    "video",
    "audio",
    "document",
    "palette",
  ];
  const availableFilters = availableCardTypes.filter(
    (type) => !filterTags.includes(type)
  );

  return (
    <div>
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
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            className="border-0 focus-visible:outline-none focus-visible:ring-0 h-16 rounded-none bg-transparent dark:bg-transparent"
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
            <Suspense>
              <SubscriptionPage />
            </Suspense>
          </UserButton.UserProfilePage>
          <UserButton.MenuItems>
            <UserButton.Action
              label={theme === "dark" ? "Light Mode" : "Dark Mode"}
              labelIcon={<Moon className="size-3.5 stroke-[2.5px] mt-0.5" />}
              onClick={() =>
                setTheme((prev) => (prev === "dark" ? "light" : "dark"))
              }
            />
          </UserButton.MenuItems>
        </UserButton>
      </div>

      {shouldShowFilters && (
        <div
          className="pb-4 animate-in slide-in-from-top-2 fade-in-0 duration-200"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="flex flex-wrap gap-2">
            {/* Keyword tags */}
            {keywordTags.map((keyword) => (
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
                  <Hash className="size-3" />
                  <span>{keyword}</span>
                </button>
              </Badge>
            ))}

            {/* Active filters */}
            {filterTags.map((filter) => {
              const IconComponent = getFilterIcon(filter);
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

            {showFavoritesOnly && (
              <Badge variant="default" className="cursor-pointer" asChild>
                <button
                  type="button"
                  onClick={onToggleFavorites}
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
                  onClick={onToggleTrash}
                  className="flex items-center gap-1"
                >
                  <Trash2 className="size-3" />
                  <span>Trash</span>
                </button>
              </Badge>
            )}

            {/* Available filters */}
            {availableFilters.map((filter) => {
              const IconComponent = getFilterIcon(filter);
              return (
                <Badge
                  key={`available-${filter}`}
                  variant="outline"
                  className="cursor-pointer"
                  asChild
                >
                  <button
                    type="button"
                    onClick={() => onAddFilter(filter)}
                    className="flex items-center gap-1"
                  >
                    <IconComponent className="size-3" />
                    <span>{CARD_TYPE_LABELS[filter]}</span>
                  </button>
                </Badge>
              );
            })}

            {!showFavoritesOnly && (
              <Badge variant="outline" className="cursor-pointer" asChild>
                <button
                  type="button"
                  onClick={onToggleFavorites}
                  className="flex items-center gap-1"
                >
                  <Heart className="size-3" />
                  <span>Favorites</span>
                </button>
              </Badge>
            )}

            {!showTrashOnly && (
              <Badge variant="outline" className="cursor-pointer" asChild>
                <button
                  type="button"
                  onClick={onToggleTrash}
                  className="flex items-center gap-1"
                >
                  <Trash2 className="size-3" />
                  <span>Trash</span>
                </button>
              </Badge>
            )}

            {hasAnyFilters && (
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
