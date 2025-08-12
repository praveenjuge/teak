import { useState } from "react";
import { CardModal } from "./CardModal";
import { SearchBar } from "./SearchBar";
import { MasonryGrid } from "./MasonryGrid";
import { EmptyState } from "./EmptyState";
import { Loading } from "./Loading";
import { useSearchFilters } from "@/hooks/useSearchFilters";
import { useCardActions } from "@/hooks/useCardActions";
import { type Doc, type Id } from "../convex/_generated/dataModel";

export function Dashboard() {
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const searchFilters = useSearchFilters();
  const cardActions = useCardActions();

  const handleCardClick = (card: Doc<"cards">) => {
    setEditingCardId(card._id);
  };

  const handleEditCancel = () => {
    setEditingCardId(null);
  };

  const handleClearFilters = () => {
    searchFilters.setSearchQuery("");
    searchFilters.setKeywordTags([]);
    searchFilters.setFilterTags([]);
    searchFilters.setShowFavoritesOnly(false);
    searchFilters.setShowTrashOnly(false);
  };

  return (
    <div>
      <SearchBar
        searchQuery={searchFilters.searchQuery}
        onSearchChange={searchFilters.handleSearchChange}
        onKeyDown={searchFilters.handleKeyDown}
        showTypeahead={searchFilters.showTypeahead}
        onTypeaheadSelect={searchFilters.handleTypeaheadSelect}
        onTypeaheadClose={() => {
          searchFilters.setShowTypeahead(false);
          searchFilters.setTypeaheadSelectedIndex(0);
        }}
        typeaheadSelectedIndex={searchFilters.typeaheadSelectedIndex}
        setTypeaheadSelectedIndex={searchFilters.setTypeaheadSelectedIndex}
        keywordTags={searchFilters.keywordTags}
        filterTags={searchFilters.filterTags}
        showFavoritesOnly={searchFilters.showFavoritesOnly}
        showTrashOnly={searchFilters.showTrashOnly}
        onRemoveKeyword={searchFilters.handleRemoveKeyword}
        onRemoveFilter={searchFilters.handleRemoveFilter}
        onRemoveFavorites={searchFilters.handleRemoveFavorites}
        onRemoveTrash={searchFilters.handleRemoveTrash}
        onClearAll={searchFilters.handleClearAllTags}
      />

      {searchFilters.cards === undefined ? (
        <Loading />
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
            onClearFilters={handleClearFilters}
          />

          {searchFilters.filteredCards.length > 0 && (
            <MasonryGrid
              filteredCards={searchFilters.filteredCards}
              showTrashOnly={searchFilters.showTrashOnly}
              onCardClick={handleCardClick}
              onDeleteCard={(cardId) =>
                cardActions.handleDeleteCard(cardId as Id<"cards">)}
              onRestoreCard={(cardId) =>
                cardActions.handleRestoreCard(cardId as Id<"cards">)}
              onPermanentDeleteCard={(cardId) =>
                cardActions.handlePermanentDeleteCard(cardId as Id<"cards">)}
              onToggleFavorite={(cardId) =>
                cardActions.handleToggleFavorite(cardId as Id<"cards">)}
            />
          )}
        </>
      )}

      <CardModal
        cardId={editingCardId}
        open={!!editingCardId}
        onCancel={handleEditCancel}
      />
    </div>
  );
}
