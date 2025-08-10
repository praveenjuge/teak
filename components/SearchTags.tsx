import { Filter, Hash, Heart, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type CardType } from "@/lib/types";

interface KeywordTagProps {
  keyword: string;
  onRemove: (keyword: string) => void;
}

export function KeywordTag({ keyword, onRemove }: KeywordTagProps) {
  return (
    <Badge className="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 transition-colors">
      <Hash className="h-3 w-3 mr-1" />
      <span className="mr-2 font-medium">{keyword}</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-auto p-0 hover:bg-blue-200/50 rounded-full"
        onClick={() => onRemove(keyword)}
      >
        <X className="h-3 w-3" />
      </Button>
    </Badge>
  );
}

interface FilterTagProps {
  filter: CardType;
  onRemove: (filter: CardType) => void;
}

const FILTER_LABELS: Record<CardType, string> = {
  text: "Text",
  link: "Links",
  image: "Images",
  video: "Videos",
  audio: "Audio",
  document: "Documents",
};

export function FilterTag({ filter, onRemove }: FilterTagProps) {
  return (
    <Badge className="bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100 transition-colors">
      <Filter className="h-3 w-3 mr-1" />
      <span className="mr-2 font-medium">{FILTER_LABELS[filter]}</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-auto p-0 hover:bg-purple-200/50 rounded-full"
        onClick={() => onRemove(filter)}
      >
        <X className="h-3 w-3" />
      </Button>
    </Badge>
  );
}

interface FavoritesTagProps {
  onRemove: () => void;
}

export function FavoritesTag({ onRemove }: FavoritesTagProps) {
  return (
    <Badge className="bg-red-50 text-red-700 border-red-200 hover:bg-red-100 transition-colors">
      <Heart className="h-3 w-3 mr-1 fill-current" />
      <span className="mr-2 font-medium">Favorites</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-auto p-0 hover:bg-red-200/50 rounded-full"
        onClick={onRemove}
      >
        <X className="h-3 w-3" />
      </Button>
    </Badge>
  );
}

interface TagContainerProps {
  keywordTags: string[];
  filterTags: CardType[];
  showFavoritesOnly: boolean;
  onRemoveKeyword: (keyword: string) => void;
  onRemoveFilter: (filter: CardType) => void;
  onRemoveFavorites: () => void;
  onClearAll: () => void;
}

export function TagContainer({
  keywordTags,
  filterTags,
  showFavoritesOnly,
  onRemoveKeyword,
  onRemoveFilter,
  onRemoveFavorites,
  onClearAll,
}: TagContainerProps) {
  const hasAnyTags = keywordTags.length > 0 || filterTags.length > 0 ||
    showFavoritesOnly;

  if (!hasAnyTags) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-3 p-4 bg-gradient-to-r from-gray-50 to-blue-50/30 rounded-lg border border-gray-100">
      <div className="flex flex-wrap gap-2">
        {keywordTags.map((keyword) => (
          <KeywordTag
            key={keyword}
            keyword={keyword}
            onRemove={onRemoveKeyword}
          />
        ))}
        {filterTags.map((filter) => (
          <FilterTag
            key={filter}
            filter={filter}
            onRemove={onRemoveFilter}
          />
        ))}
        {showFavoritesOnly && <FavoritesTag onRemove={onRemoveFavorites} />}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClearAll}
        className="text-gray-500 hover:text-gray-700 hover:bg-white/50 ml-auto"
      >
        Clear all
      </Button>
    </div>
  );
}
