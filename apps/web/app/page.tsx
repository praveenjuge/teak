"use client";

import { useState } from "react";
import { CardModal } from "@/components/CardModal";
import { SearchBar } from "@/components/SearchBar";
import { MasonryGrid } from "@/components/MasonryGrid";
import { AddCardForm } from "@/components/AddCardForm";
import { Button } from "@/components/ui/button";
import Logo from "@/components/Logo";
import { DragOverlay } from "@/components/DragOverlay";
import { CardsGridSkeleton } from "@/components/CardSkeleton";
import { useSearchFilters } from "@/hooks/useSearchFilters";
import { useCardActions } from "@/hooks/useCardActions";
import { useGlobalDragDrop } from "@/hooks/useGlobalDragDrop";
import { type Doc, type Id } from "@teak/convex/_generated/dataModel";

export const experimental_ppr = true;

export default function Home() {
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const searchFilters = useSearchFilters();
  const cardActions = useCardActions();
  const { getRootProps, getInputProps, dragDropState, canCreateCard } =
    useGlobalDragDrop();

  const handleCardClick = (card: Doc<"cards">) => {
    setEditingCardId(card._id);
  };

  const handleEditCancel = () => {
    setEditingCardId(null);
  };

  const hasNoFilters =
    searchFilters.keywordTags.length === 0 &&
    searchFilters.filterTags.length === 0 &&
    !searchFilters.showFavoritesOnly &&
    !searchFilters.showTrashOnly &&
    !searchFilters.searchQuery;

  const renderEmptyState = () => {
    if (searchFilters.filteredCards.length === 0 && hasNoFilters) {
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

    if (searchFilters.filteredCards.length === 0) {
      return (
        <div className="text-center py-12 space-y-4">
          <p className="text-muted-foreground">
            Nothing found matching your filters
          </p>
          <Button variant="outline" onClick={searchFilters.clearAllFilters}>
            Clear filters
          </Button>
        </div>
      );
    }

    return null;
  };

  return (
    <main className="max-w-7xl mx-auto px-4 pb-10">
      <div {...getRootProps()} className="relative">
        <input {...getInputProps()} />
        <SearchBar
          searchQuery={searchFilters.searchQuery}
          onSearchChange={searchFilters.handleSearchChange}
          onKeyDown={searchFilters.handleKeyDown}
          keywordTags={searchFilters.keywordTags}
          filterTags={searchFilters.filterTags}
          showFavoritesOnly={searchFilters.showFavoritesOnly}
          showTrashOnly={searchFilters.showTrashOnly}
          onAddFilter={searchFilters.addFilter}
          onRemoveFilter={searchFilters.removeFilter}
          onRemoveKeyword={searchFilters.removeKeyword}
          onToggleFavorites={searchFilters.toggleFavorites}
          onToggleTrash={searchFilters.toggleTrash}
          onClearAll={searchFilters.clearAllFilters}
        />

        {searchFilters.cards === undefined ? (
          <CardsGridSkeleton />
        ) : searchFilters.filteredCards.length > 0 ? (
          <MasonryGrid
            filteredCards={searchFilters.filteredCards}
            showTrashOnly={searchFilters.showTrashOnly}
            onCardClick={handleCardClick}
            onDeleteCard={(cardId) =>
              cardActions.handleDeleteCard(cardId as Id<"cards">)
            }
            onRestoreCard={(cardId) =>
              cardActions.handleRestoreCard(cardId as Id<"cards">)
            }
            onPermanentDeleteCard={(cardId) =>
              cardActions.handlePermanentDeleteCard(cardId as Id<"cards">)
            }
            onToggleFavorite={(cardId) =>
              cardActions.handleToggleFavorite(cardId as Id<"cards">)
            }
          />
        ) : (
          renderEmptyState()
        )}

        <CardModal
          cardId={editingCardId}
          open={!!editingCardId}
          onCancel={handleEditCancel}
        />

        <DragOverlay
          dragDropState={dragDropState}
          canCreateCard={canCreateCard}
        />
      </div>
    </main>
  );
}
