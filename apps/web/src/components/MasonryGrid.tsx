import type { Doc } from "@teak/convex/_generated/dataModel";
import type { CardWithUrls } from "@teak/ui/cards";
import { MasonryGrid as SharedMasonryGrid } from "@teak/ui/grids";
import { useCallback } from "react";
import { AddCardForm } from "./AddCardForm";

interface MasonryGridProps {
  batchSize?: number;
  filteredCards: Doc<"cards">[];
  hasMore?: boolean;
  initialBatchSize?: number;
  isLoadingMore?: boolean;
  loadMoreRootMargin?: string;
  onAddTags?: (cardId: string) => void;
  onBulkDeleteCards?: (cardIds: string[]) => Promise<{
    requestedCount: number;
    deletedCount: number;
    failedIds: string[];
  }>;
  onCardClick: (card: CardWithUrls & Record<string, unknown>) => void;
  onCopyImage?: (content: string, isImage: boolean) => void;
  onDeleteCard: (cardId: string) => Promise<boolean>;
  onLoadMore?: () => void;
  onPermanentDeleteCard: (cardId: string) => void;
  onRestoreCard: (cardId: string) => void;
  onToggleFavorite: (cardId: string) => void;
  resetKey?: string | number | boolean;
  showTrashOnly: boolean;
}

export function MasonryGrid({
  filteredCards,
  showTrashOnly,
  onCardClick,
  onDeleteCard,
  onBulkDeleteCards,
  onRestoreCard,
  onPermanentDeleteCard,
  onToggleFavorite,
  onAddTags,
  onCopyImage,
  initialBatchSize,
  batchSize,
  resetKey,
  onLoadMore,
  hasMore,
  isLoadingMore,
  loadMoreRootMargin,
}: MasonryGridProps) {
  const handlePermanentDeleteCard = useCallback(
    (cardId: string) => {
      onPermanentDeleteCard(cardId);
    },
    [onPermanentDeleteCard]
  );

  const handleRestoreCard = useCallback(
    (cardId: string) => {
      onRestoreCard(cardId);
    },
    [onRestoreCard]
  );

  const handleToggleFavorite = useCallback(
    (cardId: string) => {
      onToggleFavorite(cardId);
    },
    [onToggleFavorite]
  );

  const AddCardFormWrapper = useCallback(() => {
    return <AddCardForm />;
  }, []);

  return (
    <SharedMasonryGrid
      AddCardFormComponent={AddCardFormWrapper}
      batchSize={batchSize}
      filteredCards={filteredCards}
      hasMore={hasMore}
      initialBatchSize={initialBatchSize}
      isLoadingMore={isLoadingMore}
      loadMoreRootMargin={loadMoreRootMargin}
      onAddTags={onAddTags}
      onBulkDeleteCards={onBulkDeleteCards}
      onCardClick={onCardClick}
      onCopyImage={onCopyImage}
      onDeleteCard={onDeleteCard}
      onLoadMore={onLoadMore}
      onPermanentDeleteCard={handlePermanentDeleteCard}
      onRestoreCard={handleRestoreCard}
      onToggleFavorite={handleToggleFavorite}
      resetKey={resetKey}
      showAddForm={!showTrashOnly}
      showBulkActions={true}
      showTrashOnly={showTrashOnly}
      toastIdPrefix="web-masonry"
    />
  );
}
