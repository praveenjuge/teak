import { useState, useEffect } from "react";
import { Masonry } from "react-plock";
import { AddCardForm } from "./AddCardForm";
import { Card } from "./Card";
import { BulkActionBar } from "./BulkActionBar";
import { type Doc } from "@teak/convex/_generated/dataModel";

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
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());

  // Keyboard event handling for Shift+Click detection
  const [isShiftPressed, setIsShiftPressed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        setIsShiftPressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        setIsShiftPressed(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

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
    } else if (isShiftPressed) {
      enterSelectionMode(card._id);
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
      // Note: Individual card deletion errors are handled by the parent component
      // We still exit selection mode as some deletions may have succeeded
      exitSelectionMode();
    }
  };
  const masonryItems = () => {
    const items: Array<{
      type: "addForm" | "card";
      data?: Doc<"cards">;
      id: string;
    }> = [];

    if (!showTrashOnly) {
      items.push({ type: "addForm", id: "add-form" });
    }

    filteredCards.forEach((card) => {
      items.push({ type: "card", data: card, id: card._id });
    });

    return items;
  };

  const renderMasonryItem = (item: ReturnType<typeof masonryItems>[number]) => {
    if (item.type === "addForm") {
      return <AddCardForm key={item.id} />;
    }

    if (item.type === "card" && item.data) {
      return (
        <Card
          key={item.data._id}
          card={item.data}
          onClick={handleCardClick}
          onDelete={onDeleteCard}
          onRestore={onRestoreCard}
          onPermanentDelete={onPermanentDeleteCard}
          onToggleFavorite={onToggleFavorite}
          isTrashMode={showTrashOnly}
          isSelectionMode={isSelectionMode}
          isSelected={selectedCardIds.has(item.data._id)}
          onEnterSelectionMode={enterSelectionMode}
          onToggleSelection={() => item.data && toggleCardSelection(item.data._id)}
        />
      );
    }

    return null;
  };

  return (
    <>
      <Masonry
        items={masonryItems()}
        as="article"
        className={isSelectionMode ? "select-none" : ""}
        config={{
          columns: [1, 2, 5],
          gap: [24, 24, 24],
          media: [640, 768, 1024],
          useBalancedLayout: true,
        }}
        render={renderMasonryItem}
      />
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
