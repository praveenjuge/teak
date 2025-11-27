import { useState, useMemo } from "react";
import { Masonry } from "antd";
import type { MasonryProps } from "antd";
import { AddCardForm } from "./AddCardForm";
import { Card } from "./Card";
import { BulkActionBar } from "./BulkActionBar";
import { type Doc } from "@teak/convex/_generated/dataModel";
import * as Sentry from "@sentry/nextjs";

// Define the item type for the masonry grid
type CardItem = Doc<"cards"> | "add-form";
type MasonryItem = NonNullable<MasonryProps<CardItem>["items"]>[number];

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

  // Build masonry items array
  const masonryItems: MasonryItem[] = useMemo(() => {
    const items: MasonryItem[] = [];

    // Add the AddCardForm as the first item if not in trash mode
    if (!showTrashOnly) {
      items.push({
        key: "add-form",
        data: "add-form" as const,
      });
    }

    // Add all cards
    filteredCards.forEach((card) => {
      items.push({
        key: card._id,
        data: card,
      });
    });

    return items;
  }, [filteredCards, showTrashOnly]);

  // Render function for masonry items
  const renderItem = (item: MasonryItem & { index: number }) => {
    if (item.data === "add-form") {
      return <AddCardForm />;
    }

    const card = item.data;
    return (
      <Card
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
    );
  };

  return (
    <>
      <Masonry
        columns={{ xs: 1, sm: 2, md: 3, lg: 5, xl: 5, xxl: 5 }}
        gutter={20}
        items={masonryItems}
        itemRender={renderItem}
        fresh
        className={isSelectionMode ? "select-none" : ""}
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
