import { AddCardForm } from "./AddCardForm";
import { Button } from "@/components/ui/button";
import { type Doc } from "@teak/convex/_generated/dataModel";
import { type CardType } from "@teak/shared/constants";
import Logo from "./Logo";

interface EmptyStateProps {
  filteredCards: Doc<"cards">[];
  keywordTags: string[];
  filterTags: CardType[];
  showFavoritesOnly: boolean;
  showTrashOnly: boolean;
  searchQuery: string;
  cards: Doc<"cards">[] | undefined;
  onClearFilters: () => void;
}

export function EmptyState({
  filteredCards,
  keywordTags,
  filterTags,
  showFavoritesOnly,
  showTrashOnly,
  searchQuery,
  onClearFilters,
}: EmptyStateProps) {
  const hasNoFilters =
    keywordTags.length === 0 &&
    filterTags.length === 0 &&
    !showFavoritesOnly &&
    !showTrashOnly &&
    !searchQuery;

  if (filteredCards.length === 0 && hasNoFilters) {
    return (
      <div className="text-center flex flex-col items-center max-w-xs mx-auto py-20 gap-5">
        <Logo variant="current" />
        <AddCardForm autoFocus />
        <div className="space-y-1">
          <h3 className="font-medium">Let&apos;s add your first card!</h3>
          <p className="text-muted-foreground text-balance">
            Start capturing your thoughts, links, and media above
          </p>
        </div>
      </div>
    );
  }

  if (filteredCards.length === 0) {
    return (
      <div className="text-center py-12 space-y-4">
        <p className="text-muted-foreground">
          Nothing found matching your filters
        </p>
        <Button variant="outline" onClick={onClearFilters}>
          Clear filters
        </Button>
      </div>
    );
  }

  return null;
}
