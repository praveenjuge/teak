import { useState, useMemo, useEffect, useRef } from "react";
import { Masonry } from "antd";
import type { MasonryProps } from "antd";
import { AddCardForm } from "./AddCardForm";
import { Card } from "./Card";
import { BulkActionBar } from "./BulkActionBar";
import { Spinner } from "@/components/ui/spinner";
import { type Doc } from "@teak/convex/_generated/dataModel";
import * as Sentry from "@sentry/nextjs";

// Define the item type for the masonry grid
type CardItem = Doc<"cards"> | "add-form";
type MasonryItem = NonNullable<MasonryProps<CardItem>["items"]>[number];

const DEFAULT_BATCH_SIZE = 24;
const DEFAULT_ROOT_MARGIN = "200px 0px";

interface MasonryGridProps {
  filteredCards: Doc<"cards">[];
  showTrashOnly: boolean;
  onCardClick: (card: Doc<"cards">) => void;
  onDeleteCard: (cardId: string) => void;
  onRestoreCard: (cardId: string) => void;
  onPermanentDeleteCard: (cardId: string) => void;
  onToggleFavorite: (cardId: string) => void;
  onAddTags?: (cardId: string) => void;
  onCopyImage?: (content: string, isImage: boolean) => void;
  initialBatchSize?: number;
  batchSize?: number;
  resetKey?: string | number | boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  loadMoreRootMargin?: string;
}

export function MasonryGrid({
  filteredCards,
  showTrashOnly,
  onCardClick,
  onDeleteCard,
  onRestoreCard,
  onPermanentDeleteCard,
  onToggleFavorite,
  onAddTags,
  onCopyImage,
  initialBatchSize = DEFAULT_BATCH_SIZE,
  batchSize = DEFAULT_BATCH_SIZE,
  resetKey,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  loadMoreRootMargin = DEFAULT_ROOT_MARGIN,
}: MasonryGridProps) {
  const resolvedResetKey = resetKey ?? showTrashOnly;
  const normalizedInitialBatchSize = Math.max(1, initialBatchSize);
  const normalizedBatchSize = Math.max(1, batchSize);

  // Selection state
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(
    new Set()
  );
  const [visibleCount, setVisibleCount] = useState(() =>
    Math.min(normalizedInitialBatchSize, filteredCards.length)
  );
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRequestedRef = useRef(false);
  const resetKeyRef = useRef(resolvedResetKey);
  const prevCardsLengthRef = useRef(filteredCards.length);

  useEffect(() => {
    const didReset = resetKeyRef.current !== resolvedResetKey;
    if (didReset) {
      resetKeyRef.current = resolvedResetKey;
      loadMoreRequestedRef.current = false;
    }

    if (prevCardsLengthRef.current !== filteredCards.length) {
      prevCardsLengthRef.current = filteredCards.length;
      loadMoreRequestedRef.current = false;
    }

    setVisibleCount((prev) => {
      if (filteredCards.length === 0) {
        return 0;
      }

      const initialCount = Math.min(
        normalizedInitialBatchSize,
        filteredCards.length
      );

      if (didReset || prev === 0) {
        return initialCount;
      }

      return Math.min(prev, filteredCards.length);
    });
  }, [resolvedResetKey, filteredCards.length, normalizedInitialBatchSize]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) {
          return;
        }

        const canShowMoreLocal = visibleCount < filteredCards.length;
        if (canShowMoreLocal) {
          setVisibleCount((prev) =>
            Math.min(prev + normalizedBatchSize, filteredCards.length)
          );
          return;
        }

        const canLoadMoreRemote = Boolean(onLoadMore && hasMore !== false);
        if (canLoadMoreRemote && !loadMoreRequestedRef.current) {
          loadMoreRequestedRef.current = true;
          onLoadMore?.();
        }
      },
      { root: null, rootMargin: loadMoreRootMargin, threshold: 0 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    visibleCount,
    filteredCards.length,
    normalizedBatchSize,
    onLoadMore,
    hasMore,
    loadMoreRootMargin,
  ]);

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
    filteredCards.slice(0, visibleCount).forEach((card) => {
      items.push({
        key: card._id,
        data: card,
      });
    });

    return items;
  }, [filteredCards, showTrashOnly, visibleCount]);

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
        onAddTags={onAddTags}
        onCopyImage={onCopyImage}
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
        gutter={24}
        items={masonryItems}
        itemRender={renderItem}
        fresh
        className={isSelectionMode ? "select-none" : ""}
      />
      {filteredCards.length > 0 &&
        (visibleCount < filteredCards.length ||
          (onLoadMore && hasMore !== false)) && (
          <div ref={loadMoreRef} className="h-10 w-full" aria-hidden="true" />
        )}
      {isLoadingMore && (
        <div className="flex justify-center py-6">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      )}
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
