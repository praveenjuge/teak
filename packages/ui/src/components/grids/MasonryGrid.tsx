import type { Doc } from "@teak/convex/_generated/dataModel";
import type { CardWithUrls } from "@teak/ui/cards";
import { Card } from "@teak/ui/cards";
import { Spinner } from "@teak/ui/components/ui/spinner";
import { Masonry } from "antd";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BulkActionBar } from "../selection/BulkActionBar";

type CardItem = Doc<"cards"> | "add-form";

interface MasonryItemData {
  data: CardItem;
  key: string | number;
}

type MasonryColumns =
  | number
  | {
      xs?: number;
      sm?: number;
      md?: number;
      lg?: number;
      xl?: number;
      xxl?: number;
    };

const DEFAULT_BATCH_SIZE = 24;
const DEFAULT_ROOT_MARGIN = "200px 0px";

export interface MasonryGridProps {
  AddCardFormComponent?: React.ComponentType;
  batchSize?: number;
  columns?: MasonryColumns;
  filteredCards: Doc<"cards">[];
  gutter?: number;
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
  onPermanentDeleteCard?: (cardId: string) => void;
  onRestoreCard?: (cardId: string) => void;
  onToggleFavorite?: (cardId: string) => void;
  resetKey?: string | number | boolean;
  showAddForm?: boolean;
  showBulkActions?: boolean;
  showTrashOnly?: boolean;
  toastIdPrefix?: string;
}

export function MasonryGrid({
  filteredCards,
  showTrashOnly = false,
  showAddForm = false,
  showBulkActions = true,
  AddCardFormComponent,
  onCardClick,
  onDeleteCard,
  onBulkDeleteCards,
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
  columns = { xs: 1, sm: 2, md: 3, lg: 5, xl: 5, xxl: 5 },
  gutter = 24,
  toastIdPrefix = "masonry",
}: MasonryGridProps) {
  const resolvedResetKey = resetKey ?? showTrashOnly;
  const normalizedInitialBatchSize = Math.max(1, initialBatchSize);
  const normalizedBatchSize = Math.max(1, batchSize);

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

  const normalizedBatchSizeRef = useRef(normalizedBatchSize);
  const onLoadMoreRef = useRef(onLoadMore);
  const hasMoreRef = useRef(hasMore);
  const loadMoreRootMarginRef = useRef(loadMoreRootMargin);

  useEffect(() => {
    normalizedBatchSizeRef.current = normalizedBatchSize;
  }, [normalizedBatchSize]);
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);
  useEffect(() => {
    loadMoreRootMarginRef.current = loadMoreRootMargin;
  }, [loadMoreRootMargin]);

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
            Math.min(
              prev + normalizedBatchSizeRef.current,
              filteredCards.length
            )
          );
          return;
        }

        const canLoadMoreRemote = Boolean(
          onLoadMoreRef.current && hasMoreRef.current !== false
        );
        if (canLoadMoreRemote && !loadMoreRequestedRef.current) {
          loadMoreRequestedRef.current = true;
          onLoadMoreRef.current?.();
        }
      },
      { root: null, rootMargin: loadMoreRootMarginRef.current, threshold: 0 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, filteredCards.length]);

  const enterSelectionMode = useCallback((cardId?: string) => {
    setIsSelectionMode(true);
    if (cardId) {
      setSelectedCardIds(new Set([cardId]));
    }
  }, []);

  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedCardIds(new Set());
  }, []);

  const toggleCardSelection = useCallback((cardId: string) => {
    setSelectedCardIds((prev) => {
      const newSelected = new Set(prev);
      if (newSelected.has(cardId)) {
        newSelected.delete(cardId);
      } else {
        newSelected.add(cardId);
      }

      if (newSelected.size === 0) {
        setIsSelectionMode(false);
      }

      return newSelected;
    });
  }, []);

  const handleCardClick = useCallback(
    (card: CardWithUrls & Record<string, unknown>) => {
      if (isSelectionMode) {
        toggleCardSelection(card._id);
      } else {
        onCardClick(card);
      }
    },
    [isSelectionMode, onCardClick, toggleCardSelection]
  );

  const handleBulkDelete = useCallback(async () => {
    const requestedIds = Array.from(selectedCardIds);
    if (requestedIds.length === 0) {
      return;
    }

    const loadingToastId = toast.loading(
      `Deleting ${requestedIds.length} cards...`,
      {
        id: `${toastIdPrefix}-bulk-delete`,
      }
    );

    try {
      const summary = onBulkDeleteCards
        ? await onBulkDeleteCards(requestedIds)
        : await (async () => {
            const failedIds: string[] = [];
            let deletedCount = 0;
            for (const cardId of requestedIds) {
              const didDelete = await onDeleteCard(cardId);
              if (didDelete) {
                deletedCount += 1;
              } else {
                failedIds.push(cardId);
              }
            }
            return {
              requestedCount: requestedIds.length,
              deletedCount,
              failedIds,
            };
          })();

      if (summary.failedIds.length === 0) {
        toast.success(`Deleted ${summary.deletedCount} cards`, {
          id: loadingToastId,
        });
        exitSelectionMode();
        return;
      }

      const failedCount = summary.failedIds.length;
      if (summary.deletedCount === 0) {
        toast.error("No cards deleted", { id: loadingToastId });
      } else {
        toast.error(
          `Deleted ${summary.deletedCount} of ${summary.requestedCount} cards; ${failedCount} failed`,
          { id: loadingToastId }
        );
      }
      setSelectedCardIds(new Set(summary.failedIds));
      setIsSelectionMode(true);
    } catch (error) {
      console.error("Error during bulk delete:", error);
      toast.error("No cards deleted", { id: loadingToastId });
    }
  }, [
    selectedCardIds,
    onDeleteCard,
    onBulkDeleteCards,
    exitSelectionMode,
    toastIdPrefix,
  ]);

  const masonryItems: MasonryItemData[] = useMemo(() => {
    const items: MasonryItemData[] = [];

    if (showAddForm && !showTrashOnly && AddCardFormComponent) {
      items.push({
        key: "add-form",
        data: "add-form" as const,
      });
    }

    for (const card of filteredCards.slice(0, visibleCount)) {
      items.push({
        key: card._id,
        data: card,
      });
    }

    return items;
  }, [
    filteredCards,
    showTrashOnly,
    visibleCount,
    showAddForm,
    AddCardFormComponent,
  ]);

  const renderItem = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (item: any) => {
      if (item.data === "add-form" && AddCardFormComponent) {
        return <AddCardFormComponent />;
      }

      const card = item.data as Doc<"cards">;
      return (
        <Card
          card={card}
          isSelected={selectedCardIds.has(card._id)}
          isSelectionMode={isSelectionMode}
          isTrashMode={showTrashOnly}
          onAddTags={onAddTags}
          onClick={handleCardClick}
          onCopyImage={onCopyImage}
          onDelete={onDeleteCard}
          onEnterSelectionMode={enterSelectionMode}
          onPermanentDelete={onPermanentDeleteCard}
          onRestore={onRestoreCard}
          onToggleFavorite={onToggleFavorite}
          onToggleSelection={() => toggleCardSelection(card._id)}
        />
      );
    },
    [
      AddCardFormComponent,
      handleCardClick,
      onDeleteCard,
      onRestoreCard,
      onPermanentDeleteCard,
      onToggleFavorite,
      onAddTags,
      onCopyImage,
      showTrashOnly,
      isSelectionMode,
      selectedCardIds,
      enterSelectionMode,
      toggleCardSelection,
    ]
  );

  const bulkActionBar: ReactNode =
    showBulkActions && isSelectionMode ? (
      <BulkActionBar
        key={selectedCardIds.size}
        onCancel={exitSelectionMode}
        onDelete={handleBulkDelete}
        selectedCount={selectedCardIds.size}
      />
    ) : null;

  return (
    <>
      <Masonry
        className={isSelectionMode ? "select-none" : ""}
        columns={columns}
        gutter={gutter}
        itemRender={renderItem}
        items={masonryItems}
      />
      {filteredCards.length > 0 &&
        (visibleCount < filteredCards.length ||
          (onLoadMore && hasMore !== false)) && (
          <div aria-hidden="true" className="h-10 w-full" ref={loadMoreRef} />
        )}
      {isLoadingMore && (
        <div className="flex justify-center py-6">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      )}
      {bulkActionBar}
    </>
  );
}
