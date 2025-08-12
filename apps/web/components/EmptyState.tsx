import { Masonry } from "react-plock";
import { AddCardForm } from "./AddCardForm";
import { Button } from "@/components/ui/button";

import { type Doc } from "@teak/convex/_generated/dataModel";
import { type CardType } from "@teak/shared/constants";

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
  cards,
  onClearFilters,
}: EmptyStateProps) {
  const hasNoFilters = keywordTags.length === 0 && filterTags.length === 0 &&
    !showFavoritesOnly && !showTrashOnly && !searchQuery;

  if (filteredCards.length === 0 && hasNoFilters) {
    return (
      <div>
        <Masonry
          items={[{ type: "addForm" as const, id: "add-form" }]}
          config={{
            columns: [1, 2, 5],
            gap: [16, 16, 16],
            media: [640, 768, 1024],
          }}
          render={() => <AddCardForm key="add-form" />}
        />
        <div className="text-center py-12">
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No content yet
            </h3>
            <p className="text-muted-foreground mb-4">
              Start capturing your thoughts, links, and media using the form
              above
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (filteredCards.length === 0) {
    return (
      <div className="text-center py-12">
        {cards === undefined
          ? <p className="text-muted-foreground">Loading your content...</p>
          : (
            <div>
              <p className="text-muted-foreground mb-2">
                No content found matching your filters
              </p>
              <Button variant="outline" onClick={onClearFilters}>
                Clear filters
              </Button>
            </div>
          )}
      </div>
    );
  }

  return null;
}
