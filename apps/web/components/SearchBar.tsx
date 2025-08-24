import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Filter,
  Hash,
  Heart,
  Trash2,
  X,
  CreditCard,
} from "lucide-react";
import { SearchTypeahead } from "./SearchTypeahead";
import { UserButton } from "@clerk/nextjs";
import {
  type TypeaheadOption,
  type CardType,
  CARD_TYPE_LABELS,
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

export function SearchBar({
  searchQuery,
  onSearchChange,
  onKeyDown,
  showTypeahead,
  onTypeaheadSelect,
  onTypeaheadClose,
  typeaheadSelectedIndex,
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

  const hasAnyTags =
    keywordTags.length > 0 ||
    filterTags.length > 0 ||
    showFavoritesOnly ||
    showTrashOnly;

  return (
    <div className="flex items-center h-14">
      <div className="flex items-center gap-2">
        <Search className="text-muted-foreground size-4" />

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

        {filterTags.map((filter) => (
          <Badge
            key={filter}
            variant="outline"
            className="flex items-center gap-1"
          >
            <Filter className="size-3 fill-current" />
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
        ))}

        {showFavoritesOnly && (
          <Badge variant="destructive" className="flex items-center gap-1">
            <Heart className="size-3 fill-current" />
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
          onKeyDown={onKeyDown}
          className="border-0 focus-visible:outline-none focus-visible:ring-0 h-14 rounded-none"
          autoCapitalize="off"
          autoCorrect="off"
        />
        <SearchTypeahead
          searchValue={searchQuery}
          isVisible={showTypeahead}
          onSelect={onTypeaheadSelect}
          onClose={onTypeaheadClose}
          inputRef={inputRef}
          selectedIndex={typeaheadSelectedIndex}
          setSelectedIndex={setTypeaheadSelectedIndex}
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
  );
}
