import { Suspense, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import {
  type CardType,
  CARD_TYPE_LABELS,
  getCardTypeIcon,
  cardTypes,
} from "@teak/shared/constants";
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

// Icon component mapping for Lucide React icons
const iconComponentMap = {
  FileText,
  Link,
  Image,
  Video,
  Volume2,
  File,
  Palette,
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
  const { setTheme, theme } = useTheme();
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
          className="pb-5 animate-in slide-in-from-top-2 fade-in-0 duration-200"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="flex flex-wrap gap-2">
            {/* Keyword tags */}
            {keywordTags.map((keyword) => (
              <Button
                key={`keyword-${keyword}`}
                variant="default"
                size="sm"
                onClick={() => onRemoveKeyword(keyword)}
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
                  variant="default"
                  size="sm"
                  onClick={() => onRemoveFilter(filter)}
                >
                  <IconComponent className="size-3.5 stroke-2" />
                  <span>{CARD_TYPE_LABELS[filter]}</span>
                </Button>
              );
            })}

            {showFavoritesOnly && (
              <Button variant="default" size="sm" onClick={onToggleFavorites}>
                <Heart className="size-3.5 stroke-2" />
                <span>Favorites</span>
              </Button>
            )}

            {showTrashOnly && (
              <Button variant="default" size="sm" onClick={onToggleTrash}>
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
                  variant="outline"
                  size="sm"
                  onClick={() => onAddFilter(filter)}
                >
                  <IconComponent className="size-3.5 stroke-2" />
                  <span>{CARD_TYPE_LABELS[filter]}</span>
                </Button>
              );
            })}

            {!showFavoritesOnly && (
              <Button variant="outline" size="sm" onClick={onToggleFavorites}>
                <Heart className="size-3.5 stroke-2" />
                <span>Favorites</span>
              </Button>
            )}

            {!showTrashOnly && (
              <Button variant="outline" size="sm" onClick={onToggleTrash}>
                <Trash2 className="size-3.5 stroke-2" />
                <span>Trash</span>
              </Button>
            )}

            {hasAnyFilters && (
              <Button variant="outline" size="sm" onClick={onClearAll}>
                Clear All
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
