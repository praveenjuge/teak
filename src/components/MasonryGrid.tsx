import { useState } from "react";
import Masonry from "react-masonry-css";
import { AddCardForm } from "./AddCardForm";
import { Card } from "./Card";
import { BulkActionBar } from "./BulkActionBar";
import { type Doc } from "@teak/convex/_generated/dataModel";
import * as Sentry from "@sentry/nextjs";

interface MasonryGridProps {
  filteredCards: Doc<"cards">[];
  showTrashOnly: boolean;
  onCardClick: (card: Doc<"cards">) => void;
  onDeleteCard: (cardId: string) => void;
  onRestoreCard: (cardId: string) => void;
  onPermanentDeleteCard: (cardId: string) => void;
  onToggleFavorite: (cardId: string) => void;
}

export function MasonryGrid({
  filteredCards,
  showTrashOnly,
  onCardClick,
  onDeleteCard,
  onRestoreCard,
  onPermanentDeleteCard,
  onToggleFavorite,
}: MasonryGridProps) {
  // Selection state
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(
    new Set()
  );

  // Selection handlers
  const enterSelectionMode = (cardId?: string) => {
    setIsSelectionMode(true);
    if (cardId) {
      setSelectedCardIds(new Set([cardId]));
    }
  };

  const exitSelectionMode = () => {
    setIsSelectionMode(false);
    setSelectedCardIds(new Set());
  };

  const toggleCardSelection = (cardId: string) => {
    setSelectedCardIds((prev) => {
      const newSelected = new Set(prev);
      if (newSelected.has(cardId)) {
        newSelected.delete(cardId);
      } else {
        newSelected.add(cardId);
      }

      // Exit selection mode if no cards are selected
      if (newSelected.size === 0) {
        setIsSelectionMode(false);
      }

      return newSelected;
    });
  };

  const handleCardClick = (card: Doc<"cards">) => {
    if (isSelectionMode) {
      toggleCardSelection(card._id);
    } else {
      onCardClick(card);
    }
  };

  const handleBulkDelete = async () => {
    try {
      // Process deletions sequentially to avoid overwhelming the system
      for (const cardId of selectedCardIds) {
        onDeleteCard(cardId);
      }
      exitSelectionMode();
    } catch (error) {
      console.error("Error during bulk delete:", error);
      Sentry.captureException(error, {
        tags: { source: "convex", operation: "bulkDelete" },
        extra: { selectedCount: selectedCardIds.size },
      });
      // Note: Individual card deletion errors are handled by the parent component
      // We still exit selection mode as some deletions may have succeeded
      exitSelectionMode();
    }
  };
  return (
    <>
      <Masonry
        breakpointCols={{
          default: 5,
          1024: 5,
          768: 2,
          640: 1,
        }}
        className={`masonry-grid ${isSelectionMode ? "select-none" : ""}`}
        columnClassName="masonry-grid-column"
      >
        {!showTrashOnly && <AddCardForm key="add-form" />}
        {filteredCards.map((card) => (
          <Card
            key={card._id}
            card={card}
            onClick={handleCardClick}
            onDelete={onDeleteCard}
            onRestore={onRestoreCard}
            onPermanentDelete={onPermanentDeleteCard}
            onToggleFavorite={onToggleFavorite}
            isTrashMode={showTrashOnly}
            isSelectionMode={isSelectionMode}
            isSelected={selectedCardIds.has(card._id)}
            onEnterSelectionMode={enterSelectionMode}
            onToggleSelection={() => toggleCardSelection(card._id)}
          />
        ))}
      </Masonry>
      {isSelectionMode && (
        <BulkActionBar
          selectedCount={selectedCardIds.size}
          onDelete={handleBulkDelete}
          onCancel={exitSelectionMode}
        />
      )}
    </>
  );
}
