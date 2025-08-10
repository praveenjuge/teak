import { Filter, Hash, Heart, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type CardType } from "@/lib/types";
import { Card, CardContent } from "./ui/card";

interface KeywordTagProps {
  keyword: string;
  onRemove: (keyword: string) => void;
}

export function KeywordTag({ keyword, onRemove }: KeywordTagProps) {
  return (
    <Badge variant="outline">
      <Hash />
      <span>{keyword}</span>
      <Button
        size="icon"
        variant="ghost"
        className="size-4"
        onClick={() => onRemove(keyword)}
      >
        <X />
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
    <Badge variant="outline">
      <Filter className="fill-current" />
      <span>{FILTER_LABELS[filter]}</span>
      <Button
        size="icon"
        variant="ghost"
        className="size-4"
        onClick={() => onRemove(filter)}
      >
        <X />
      </Button>
    </Badge>
  );
}

interface FavoritesTagProps {
  onRemove: () => void;
}

export function FavoritesTag({ onRemove }: FavoritesTagProps) {
  return (
    <Badge variant="destructive">
      <Heart className="fill-current" />
      <span>Favorites</span>
      <Button
        size="icon"
        variant="ghost"
        className="size-4"
        onClick={onRemove}
      >
        <X />
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
    <Card className="p-0 shadow-none mb-4 border-0">
      <CardContent className="p-0 flex flex-wrap gap-2">
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
        <Button
          size="sm"
          variant="outline"
          onClick={onClearAll}
        >
          Clear
        </Button>
      </CardContent>
    </Card>
  );
}
