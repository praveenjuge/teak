"use client";

import { useState } from "react";
import { Authenticated, AuthLoading } from "convex/react";
import { CardModal } from "@/components/CardModal";
import { SearchBar } from "@/components/SearchBar";
import { MasonryGrid } from "@/components/MasonryGrid";
import { EmptyState } from "@/components/EmptyState";
import { Loading } from "@/components/Loading";
import { DragOverlay } from "@/components/DragOverlay";
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

  return (
    <main className="max-w-7xl mx-auto px-4 pb-10">
      <AuthLoading>
        <Loading fullScreen={true} />
      </AuthLoading>
      <Authenticated>
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
            <Loading className="h-96" />
          ) : (
            <>
              <EmptyState
                filteredCards={searchFilters.filteredCards}
                keywordTags={searchFilters.keywordTags}
                filterTags={searchFilters.filterTags}
                showFavoritesOnly={searchFilters.showFavoritesOnly}
                showTrashOnly={searchFilters.showTrashOnly}
                searchQuery={searchFilters.searchQuery}
                cards={searchFilters.cards}
                onClearFilters={searchFilters.clearAllFilters}
              />

              {searchFilters.filteredCards.length > 0 && (
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
              )}
            </>
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
      </Authenticated>
    </main>
  );
}
