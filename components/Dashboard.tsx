import { useState } from "react";
import { CardModal } from "./CardModal";
import { SearchBar } from "./SearchBar";
import { MasonryGrid } from "./MasonryGrid";
import { EmptyState } from "./EmptyState";
import { TagContainer } from "./SearchTags";
import { useSearchFilters } from "@/hooks/useSearchFilters";
import { useCardActions } from "@/hooks/useCardActions";
import { type CardData } from "@/lib/types";

export function Dashboard() {
  const [editingCard, setEditingCard] = useState<CardData | null>(null);
  const searchFilters = useSearchFilters();
  const cardActions = useCardActions();

  const handleCardClick = (card: CardData) => {
    setEditingCard(card);
  };

  const handleEditCancel = () => {
    setEditingCard(null);
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
      />

      <TagContainer
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
          onDeleteCard={cardActions.handleDeleteCard}
          onRestoreCard={cardActions.handleRestoreCard}
          onPermanentDeleteCard={cardActions.handlePermanentDeleteCard}
          onToggleFavorite={cardActions.handleToggleFavorite}
        />
      )}

      <CardModal
        card={editingCard}
        open={!!editingCard}
        onCancel={handleEditCancel}
        onDelete={cardActions.handleDeleteCard}
        onRestore={cardActions.handleRestoreCard}
        onPermanentDelete={cardActions.handlePermanentDeleteCard}
        onToggleFavorite={cardActions.handleToggleFavorite}
        isTrashMode={searchFilters.showTrashOnly}
      />
    </div>
  );
}
