import type { Doc } from "@teak/convex/_generated/dataModel";
import type { CardWithUrls } from "@teak/ui/cards";
import { Card } from "@teak/ui/cards";
import { Spinner } from "@teak/ui/components/ui/spinner";
import { Masonry } from "antd";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type BulkCardAction,
  type BulkFolderTarget,
  collectCardLinks,
} from "../../lib/bulkCardActions";
import type { FolderSummary } from "../../lib/folders";
import { CardFoldersDialog } from "../folders/CardFoldersDialog";
import { FolderPickerDialog } from "../folders/FolderPickerDialog";
import {
  BulkActionBar,
  type BulkBarAction,
  type BulkBarFolder,
  type BulkBarView,
} from "../selection/BulkActionBar";
import { BulkTagsDialog } from "../selection/BulkTagsDialog";
import { ConfirmDialog } from "../ui/confirm-dialog";

type CardItem = Doc<"cards"> | "add-form";

interface MasonryItemData {
  data: CardItem;
  isPriority?: boolean;
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
const MIN_COLUMN_WIDTH = 200;
const MAX_COLUMNS = 5;

/**
 * How many columns fit the grid's own width, so the sidebar (open, collapsed
 * or hidden) never squeezes cards below a readable width.
 */
export const columnsForWidth = (width: number, gutter: number): number =>
  Math.min(
    MAX_COLUMNS,
    Math.max(1, Math.floor((width + gutter) / (MIN_COLUMN_WIDTH + gutter)))
  );

// Before the grid is measured (and on the server) the viewport decides.
const FALLBACK_COLUMNS = { xs: 1, sm: 2, md: 3, lg: 5, xl: 5, xxl: 5 };
const DEFAULT_ROOT_MARGIN = "200px 0px";
// Cards near the top of the grid are above the fold on every screen size, so
// their media loads eagerly with high fetch priority instead of lazily.
const PRIORITY_CARD_COUNT = 10;

export interface MasonryGridProps {
  AddCardFormComponent?: React.ComponentType;
  /**
   * Choosing cards for this folder: the grid opens in selection mode and
   * the bar's one action adds the selection to it.
   */
  addToFolder?: BulkBarFolder;
  batchSize?: number;
  columns?: MasonryColumns;
  filteredCards: Doc<"cards">[];
  /** The folder being viewed, offered as Remove from folder. */
  folder?: BulkBarFolder;
  gutter?: number;
  hasMore?: boolean;
  initialBatchSize?: number;
  isLoadingMore?: boolean;
  loadMoreRootMargin?: string;
  onAddTags?: (cardId: string) => void;
  /** Leaves "choose cards for a folder", after adding or on Cancel. */
  onAddToFolderDone?: (added: boolean) => void;
  /**
   * Runs a bulk bar action on the selected cards and resolves with the ones
   * that failed; those stay selected so the user can try again.
   */
  onBulkAction?: (
    action: BulkCardAction,
    cardIds: string[],
    options?: { folder?: BulkFolderTarget; tags?: string[] }
  ) => Promise<{ failedIds: string[] }>;
  onCardClick: (card: CardWithUrls & Record<string, unknown>) => void;
  onCopyImage?: (content: string, isImage: boolean) => void;
  onDeleteCard: (cardId: string) => Promise<boolean>;
  onLoadMore?: () => void;
  onPermanentDeleteCard?: (cardId: string) => void;
  onRestoreCard?: (cardId: string) => void;
  onToggleArchive?: (cardId: string, archive: boolean) => void;
  onToggleFavorite?: (cardId: string) => void;
  resetKey?: string | number | boolean;
  showAddForm?: boolean;
  /** The Archive view: the bulk bar offers Unarchive instead of Archive. */
  showArchivedOnly?: boolean;
  showBulkActions?: boolean;
  showTrashOnly?: boolean;
  toastIdPrefix?: string;
}

export function MasonryGrid({
  addToFolder,
  folder,
  onAddToFolderDone,
  filteredCards,
  showTrashOnly = false,
  showArchivedOnly = false,
  showAddForm = false,
  showBulkActions = true,
  AddCardFormComponent,
  onCardClick,
  onDeleteCard,
  onBulkAction,
  onRestoreCard,
  onPermanentDeleteCard,
  onToggleArchive,
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
  columns,
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
  const [pendingPermanentDeleteId, setPendingPermanentDeleteId] = useState<
    string | null
  >(null);
  const [tagsDialogMode, setTagsDialogMode] = useState<"add" | "remove" | null>(
    null
  );
  const [isBulkBusy, setIsBulkBusy] = useState(false);
  const [folderPickerMode, setFolderPickerMode] = useState<
    "add" | "move" | null
  >(null);
  const [foldersCardId, setFoldersCardId] = useState<string | null>(null);
  // Choosing cards for a folder keeps selection mode on even with nothing
  // picked, until the user adds them or cancels.
  const keepSelectionMode = Boolean(addToFolder);
  useEffect(() => {
    if (addToFolder) {
      setIsSelectionMode(true);
      setSelectedCardIds(new Set());
    }
  }, [addToFolder]);
  const [visibleCount, setVisibleCount] = useState(() =>
    Math.min(normalizedInitialBatchSize, filteredCards.length)
  );
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [measuredColumns, setMeasuredColumns] = useState<number | null>(null);
  useEffect(() => {
    const grid = gridRef.current;
    if (columns !== undefined || !grid) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setMeasuredColumns(columnsForWidth(entry.contentRect.width, gutter));
      }
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [columns, gutter]);
  const resolvedColumns = columns ?? measuredColumns ?? FALLBACK_COLUMNS;
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

  const toggleCardSelection = useCallback(
    (cardId: string) => {
      setSelectedCardIds((prev) => {
        const newSelected = new Set(prev);
        if (newSelected.has(cardId)) {
          newSelected.delete(cardId);
        } else {
          newSelected.add(cardId);
        }

        if (newSelected.size === 0 && !keepSelectionMode) {
          setIsSelectionMode(false);
        }

        return newSelected;
      });
    },
    [keepSelectionMode]
  );

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

  let bulkView: BulkBarView = "library";
  if (showTrashOnly) {
    bulkView = "trash";
  } else if (showArchivedOnly) {
    bulkView = "archive";
  }

  const foldersCardFolderIds = useMemo(
    () =>
      (filteredCards.find((card) => card._id === foldersCardId)?.folderIds ??
        []) as string[],
    [filteredCards, foldersCardId]
  );

  const selectedCards = useMemo(
    () => filteredCards.filter((card) => selectedCardIds.has(card._id)),
    [filteredCards, selectedCardIds]
  );

  // Tags on the selection, offered as choices when removing tags.
  const selectionTags = useMemo(() => {
    const byName = new Map<string, string>();
    for (const card of selectedCards) {
      for (const tag of [...(card.tags ?? []), ...(card.aiTags ?? [])]) {
        if (!byName.has(tag.toLowerCase())) {
          byName.set(tag.toLowerCase(), tag);
        }
      }
    }
    return Array.from(byName.values())
      .sort((left, right) => left.localeCompare(right))
      .slice(0, 40);
  }, [selectedCards]);

  const runBulk = useCallback(
    async (
      action: BulkCardAction,
      options: { folder?: BulkFolderTarget; tags?: string[] } = {}
    ) => {
      const cardIds = Array.from(selectedCardIds);
      if (!onBulkAction || cardIds.length === 0 || isBulkBusy) {
        return;
      }
      setIsBulkBusy(true);
      try {
        const { failedIds } = await onBulkAction(action, cardIds, options);
        if (failedIds.length === 0) {
          exitSelectionMode();
          if (addToFolder) {
            onAddToFolderDone?.(true);
          }
        } else {
          setSelectedCardIds(new Set(failedIds));
          setIsSelectionMode(true);
        }
      } finally {
        setIsBulkBusy(false);
      }
    },
    [
      addToFolder,
      exitSelectionMode,
      isBulkBusy,
      onAddToFolderDone,
      onBulkAction,
      selectedCardIds,
    ]
  );

  const pickFolder = useCallback(
    (picked: FolderSummary) => {
      if (folderPickerMode === "move") {
        runBulk("moveToFolder", {
          folder: {
            folderId: picked._id,
            folderName: picked.name,
            ...(folder
              ? { fromFolderId: folder.id, fromFolderName: folder.name }
              : {}),
          },
        }).catch(() => undefined);
        return;
      }
      runBulk("addToFolder", {
        folder: { folderId: picked._id, folderName: picked.name },
      }).catch(() => undefined);
    },
    [folder, folderPickerMode, runBulk]
  );

  const handleBulkAction = useCallback(
    (action: BulkBarAction) => {
      if (action === "addTags" || action === "removeTags") {
        setTagsDialogMode(action === "addTags" ? "add" : "remove");
        return;
      }
      if (action === "addToFolder" && addToFolder) {
        runBulk("addToFolder", {
          folder: { folderId: addToFolder.id, folderName: addToFolder.name },
        }).catch(() => undefined);
        return;
      }
      if (action === "addToFolder" || action === "moveToFolder") {
        setFolderPickerMode(action === "addToFolder" ? "add" : "move");
        return;
      }
      if (action === "removeFromFolder") {
        if (folder) {
          runBulk("removeFromFolder", {
            folder: { folderId: folder.id, folderName: folder.name },
          }).catch(() => undefined);
        }
        return;
      }
      if (action === "copyLinks") {
        const links = collectCardLinks(selectedCards);
        if (links.length === 0) {
          toast("None of these cards have a link", {
            id: `${toastIdPrefix}-copy-links`,
          });
          return;
        }
        navigator.clipboard
          .writeText(links.join("\n"))
          .then(() =>
            toast.success(
              `Copied ${links.length} link${links.length === 1 ? "" : "s"}`,
              { id: `${toastIdPrefix}-copy-links` }
            )
          )
          .catch(() =>
            toast.error("Couldn't copy the links", {
              id: `${toastIdPrefix}-copy-links`,
            })
          );
        return;
      }
      runBulk(action).catch(() => undefined);
    },
    [addToFolder, folder, runBulk, selectedCards, toastIdPrefix]
  );

  // "Delete Forever" can't be undone, so it always asks first.
  const requestPermanentDelete = useMemo(
    () =>
      onPermanentDeleteCard
        ? (cardId: string) => setPendingPermanentDeleteId(cardId)
        : undefined,
    [onPermanentDeleteCard]
  );

  const confirmPermanentDelete = useCallback(() => {
    if (pendingPermanentDeleteId) {
      onPermanentDeleteCard?.(pendingPermanentDeleteId);
    }
    setPendingPermanentDeleteId(null);
  }, [onPermanentDeleteCard, pendingPermanentDeleteId]);

  const masonryItems: MasonryItemData[] = useMemo(() => {
    const items: MasonryItemData[] = [];

    if (showAddForm && !showTrashOnly && AddCardFormComponent) {
      items.push({
        key: "add-form",
        data: "add-form" as const,
      });
    }

    for (const [index, card] of filteredCards
      .slice(0, visibleCount)
      .entries()) {
      items.push({
        data: card,
        isPriority: index < PRIORITY_CARD_COUNT,
        key: card._id,
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
          isPriority={item.isPriority === true}
          isSelected={selectedCardIds.has(card._id)}
          isSelectionMode={isSelectionMode}
          isTrashMode={showTrashOnly}
          onAddTags={onAddTags}
          onClick={handleCardClick}
          onCopyImage={onCopyImage}
          onDelete={onDeleteCard}
          onEditFolders={setFoldersCardId}
          onEnterSelectionMode={enterSelectionMode}
          onPermanentDelete={requestPermanentDelete}
          onRestore={onRestoreCard}
          onToggleArchive={onToggleArchive}
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
      requestPermanentDelete,
      onToggleArchive,
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
    showBulkActions && onBulkAction && isSelectionMode ? (
      <BulkActionBar
        addToFolder={addToFolder}
        folder={folder}
        isBusy={isBulkBusy}
        onAction={handleBulkAction}
        onCancel={() => {
          exitSelectionMode();
          if (addToFolder) {
            onAddToFolderDone?.(false);
          }
        }}
        selectedCount={selectedCardIds.size}
        view={bulkView}
      />
    ) : null;

  return (
    <>
      <div ref={gridRef}>
        <Masonry
          className={isSelectionMode ? "select-none" : ""}
          columns={resolvedColumns}
          fresh
          gutter={gutter}
          itemRender={renderItem}
          items={masonryItems}
        />
      </div>
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
      <BulkTagsDialog
        mode={tagsDialogMode ?? "add"}
        onOpenChange={(open) => {
          if (!open) {
            setTagsDialogMode(null);
          }
        }}
        onSubmit={(tags) => {
          const action = tagsDialogMode === "remove" ? "removeTags" : "addTags";
          runBulk(action, { tags }).catch(() => undefined);
        }}
        open={tagsDialogMode !== null}
        selectedCount={selectedCardIds.size}
        suggestions={selectionTags}
      />
      <FolderPickerDialog
        excludeFolderId={folderPickerMode === "move" ? folder?.id : undefined}
        mode={folderPickerMode ?? "add"}
        onOpenChange={(open) => {
          if (!open) {
            setFolderPickerMode(null);
          }
        }}
        onPick={pickFolder}
        open={folderPickerMode !== null}
        selectedCount={selectedCardIds.size}
      />
      <CardFoldersDialog
        cardId={foldersCardId}
        folderIds={foldersCardFolderIds}
        onOpenChange={(open) => {
          if (!open) {
            setFoldersCardId(null);
          }
        }}
        open={foldersCardId !== null}
      />
      <ConfirmDialog
        confirmLabel="Delete Forever"
        description="This permanently deletes the card and its files. This can’t be undone."
        onConfirm={confirmPermanentDelete}
        onOpenChange={(open) => {
          if (!open) {
            setPendingPermanentDeleteId(null);
          }
        }}
        open={pendingPermanentDeleteId !== null}
        title="Delete this card forever?"
      />
    </>
  );
}
