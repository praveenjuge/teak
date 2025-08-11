import { useMemo } from "react";
import { Masonry } from "react-plock";
import { AddCardForm } from "./AddCardForm";
import { Card } from "./Card";
import { type Doc } from "../convex/_generated/dataModel";

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
  const masonryItems = useMemo(() => {
    const items: Array<
      { type: "addForm" | "card"; data?: Doc<"cards">; id: string }
    > = [];

    if (!showTrashOnly) {
      items.push({ type: "addForm", id: "add-form" });
    }

    filteredCards.forEach((card) => {
      items.push({ type: "card", data: card, id: card._id });
    });

    return items;
  }, [filteredCards, showTrashOnly]);

  const renderMasonryItem = (item: typeof masonryItems[0]) => {
    if (item.type === "addForm") {
      return <AddCardForm key={item.id} />;
    }

    if (item.type === "card" && item.data) {
      return (
        <Card
          key={item.data._id}
          card={item.data}
          onClick={onCardClick}
          onDelete={onDeleteCard}
          onRestore={onRestoreCard}
          onPermanentDelete={onPermanentDeleteCard}
          onToggleFavorite={onToggleFavorite}
          isTrashMode={showTrashOnly}
        />
      );
    }

    return null;
  };

  return (
    <Masonry
      items={masonryItems}
      config={{
        columns: [1, 2, 5],
        gap: [16, 16, 16],
        media: [640, 768, 1024],
      }}
      render={renderMasonryItem}
    />
  );
}
