"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { CardModal } from "@/components/CardModal";
import { SearchBar } from "@/components/SearchBar";
import { MasonryGrid } from "@/components/MasonryGrid";
import { AddCardForm } from "@/components/AddCardForm";
import { Button } from "@/components/ui/button";
import Logo from "@/components/Logo";
import { DragOverlay } from "@/components/DragOverlay";
import { CardsGridSkeleton } from "@/components/CardSkeleton";
import { useGlobalDragDrop } from "@/hooks/useGlobalDragDrop";
import { type Doc, type Id } from "@teak/convex/_generated/dataModel";
import { type CardType } from "@teak/convex/shared/constants";
import { useCardActions } from "@/hooks/useCardActions";
import { api } from "@teak/convex";
import { toast } from "sonner";

const DEFAULT_CARD_LIMIT = 100;

export default function HomePage() {
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [keywordTags, setKeywordTags] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<CardType[]>([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showTrashOnly, setShowTrashOnly] = useState(false);

  const searchTerms = useMemo(
    () =>
      [
        ...keywordTags,
        ...(searchQuery.trim() ? [searchQuery.trim()] : []),
      ].join(" "),
    [keywordTags, searchQuery]
  );

  const queryArgs = useMemo(
    () => ({
      searchQuery: searchTerms || undefined,
      types: filterTags.length > 0 ? filterTags : undefined,
      favoritesOnly: showFavoritesOnly || undefined,
      showTrashOnly: showTrashOnly || undefined,
      limit: DEFAULT_CARD_LIMIT,
    }),
    [filterTags, searchTerms, showFavoritesOnly, showTrashOnly]
  );

  const cards = useQuery(api.cards.searchCards, queryArgs);

  const cardActions = useCardActions({
    onDeleteSuccess: (message) => message && toast(message),
    onRestoreSuccess: (message) => message && toast(message),
    onPermanentDeleteSuccess: (message) => message && toast(message),
    onError: (_error, operation) => {
      toast.error(`Failed to ${operation}`);
    },
  });

  const {
    getRootProps,
    getInputProps,
    dragDropState,
    dismissUpgradePrompt,
    navigateToUpgrade,
  } = useGlobalDragDrop();

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();

      if (
        ["fav", "favs", "favorites", "favourite", "favourites"].includes(query)
      ) {
        setShowFavoritesOnly(!showFavoritesOnly);
        setSearchQuery("");
        return;
      }

      if (["trash", "deleted", "bin", "recycle", "trashed"].includes(query)) {
        setShowTrashOnly(!showTrashOnly);
        setSearchQuery("");
        return;
      }

      if (!keywordTags.includes(query)) {
        setKeywordTags((prev) => [...prev, query]);
      }
      setSearchQuery("");
    } else if (
      e.key === "Backspace" &&
      searchQuery === "" &&
      (keywordTags.length > 0 ||
        filterTags.length > 0 ||
        showFavoritesOnly ||
        showTrashOnly)
    ) {
      if (showTrashOnly) {
        setShowTrashOnly(false);
      } else if (showFavoritesOnly) {
        setShowFavoritesOnly(false);
      } else if (filterTags.length > 0) {
        setFilterTags((prev) => prev.slice(0, -1));
      } else if (keywordTags.length > 0) {
        setKeywordTags((prev) => prev.slice(0, -1));
      }
    }
  };

  const addFilter = (filter: CardType) => {
    if (!filterTags.includes(filter)) {
      setFilterTags((prev) => [...prev, filter]);
    }
  };

  const removeFilter = (filter: CardType) => {
    setFilterTags((prev) => prev.filter((tag) => tag !== filter));
  };

  const removeKeyword = (keyword: string) => {
    setKeywordTags((prev) => prev.filter((tag) => tag !== keyword));
  };

  const toggleFavorites = () => {
    setShowFavoritesOnly(!showFavoritesOnly);
  };

  const toggleTrash = () => {
    setShowTrashOnly(!showTrashOnly);
  };

  const clearAllFilters = () => {
    setSearchQuery("");
    setKeywordTags([]);
    setFilterTags([]);
    setShowFavoritesOnly(false);
    setShowTrashOnly(false);
  };

  const handleCardClick = (card: Doc<"cards">) => {
    setEditingCardId(card._id);
  };

  const handleEditCancel = () => {
    setEditingCardId(null);
  };

  const handleCardTypeClick = (cardType: string) => {
    setEditingCardId(null);
    addFilter(cardType as CardType);
  };

  const handleTagClick = (tag: string) => {
    setEditingCardId(null);
    if (!keywordTags.includes(tag)) {
      setKeywordTags((prev) => [...prev, tag]);
    }
  };

  const hasNoFilters =
    keywordTags.length === 0 &&
    filterTags.length === 0 &&
    !showFavoritesOnly &&
    !showTrashOnly &&
    !searchQuery;

  const renderEmptyState = () => {
    if ((cards?.length || 0) === 0 && hasNoFilters) {
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

    if ((cards?.length || 0) === 0) {
      return (
        <div className="text-center py-12 space-y-4">
          <p className="text-muted-foreground">
            Nothing found matching your filters
          </p>
          <Button variant="outline" onClick={clearAllFilters}>
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
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          onKeyDown={handleKeyDown}
          keywordTags={keywordTags}
          filterTags={filterTags}
          showFavoritesOnly={showFavoritesOnly}
          showTrashOnly={showTrashOnly}
          onAddFilter={addFilter}
          onRemoveFilter={removeFilter}
          onRemoveKeyword={removeKeyword}
          onToggleFavorites={toggleFavorites}
          onToggleTrash={toggleTrash}
          onClearAll={clearAllFilters}
        />

        {cards === undefined ? (
          <CardsGridSkeleton />
        ) : (cards?.length || 0) > 0 ? (
          <MasonryGrid
            filteredCards={cards}
            showTrashOnly={showTrashOnly}
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
          onCardTypeClick={handleCardTypeClick}
          onTagClick={handleTagClick}
        />

        <DragOverlay
          dragDropState={dragDropState}
          dismissUpgradePrompt={dismissUpgradePrompt}
          navigateToUpgrade={navigateToUpgrade}
        />
      </div>
    </main>
  );
}
