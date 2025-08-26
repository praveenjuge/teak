import { Masonry } from "react-plock";
import { AddCardForm } from "./AddCardForm";
import { Card } from "./Card";
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
      items={masonryItems()}
      as="article"
      config={{
        columns: [1, 2, 5],
        gap: [24, 24, 24],
        media: [640, 768, 1024],
        useBalancedLayout: true,
      }}
      render={renderMasonryItem}
    />
  );
}
