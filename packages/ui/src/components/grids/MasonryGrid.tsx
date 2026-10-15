import type { Doc } from "@teak/convex/_generated/dataModel";
import type { CardWithUrls } from "@teak/ui/cards";
import { Card } from "@teak/ui/cards";
import { Spinner } from "@teak/ui/components/ui/spinner";
import { Masonry } from "antd";
import type { FocusEvent, KeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import {
  type BulkCardAction,
  type BulkFolderTarget,
  collectCardLinks,
} from "../../lib/bulkCardActions";
import type { FolderSummary } from "../../lib/folders";
import { type GridDirection, nextCardIndex } from "../../lib/gridNavigation";
import { isOptimisticCard } from "../cards/types";
import {
  BulkTagsDialog,
  CardFoldersDialog,
  FolderPickerDialog,
} from "../lazyDialogs";
import {
  BulkActionBar,
  type BulkBarAction,
  type BulkBarFolder,
  type BulkBarView,
} from "../selection/BulkActionBar";
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
// How long focus waits for the card modal to finish closing.
const MODAL_CLOSE_WAIT_MS = 1000;

const GRID_DIRECTIONS: Record<string, GridDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  j: "next",
  k: "previous",
};
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
    options?: {
      folder?: BulkFolderTarget;
      priorFolderIds?: ReadonlyMap<string, readonly string[]>;
      tags?: string[];
    }
  ) => Promise<{ failedIds: string[] }>;
  onCardClick: (card: CardWithUrls & Record<string, unknown>) => void;
  onCopyImage?: (content: string, isImage: boolean) => void;
  onDeleteCard: (cardId: string) => Promise<boolean>;
  onLoadMore?: () => void;
  onPermanentDeleteCard?: (cardId: string) => void;
  onRestoreCard?: (cardId: string) => void;
  onToggleArchive?: (cardId: string, archive: boolean) => void;
  onToggleFavorite?: (cardId: string) => void;
  /** The card open in the modal; when it closes, focus returns to the grid. */
  openCardId?: string | null;
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
  openCardId,
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
  // Keyed on the folder ID: the screen passes a fresh object each render, and
  // a render (loading more cards, a live update) must not clear the picks.
  const addToFolderId = addToFolder?.id;
  useEffect(() => {
    if (addToFolderId) {
      setIsSelectionMode(true);
      setSelectedCardIds(new Set());
    }
  }, [addToFolderId]);
  const [visibleCount, setVisibleCount] = useState(() =>
    Math.min(normalizedInitialBatchSize, filteredCards.length)
  );
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  // The card the grid's one tab stop is on; arrows and J/K move it.
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  // Whether keyboard focus was last in the grid, so focus can follow when
  // the focused card leaves it (moved to Trash, archived).
  const gridFocusedRef = useRef(false);
  const lastActiveIndexRef = useRef(0);
  // A card opened from the grid, so closing the modal can focus it again.
  const openedFromGridRef = useRef(false);
  const previousOpenCardIdRef = useRef(openCardId ?? null);
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
    // The sentinel only renders while the grid can grow, so this re-runs when
    // hasMore turns true (a filter's first page can arrive before that).
    const canGrow = visibleCount < filteredCards.length || hasMore !== false;
    const sentinel = loadMoreRef.current;
    if (!(sentinel && canGrow)) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        // One callback can carry several reports, oldest first: the first
        // check (sentinel below the fold) and then a scroll that brought it
        // into view. Only the newest says where the sentinel is now.
        const entry = entries[entries.length - 1];
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
  }, [visibleCount, filteredCards.length, hasMore]);

  const visibleCards = useMemo(
    () => filteredCards.slice(0, visibleCount),
    [filteredCards, visibleCount]
  );
  // Cards still being saved can't be focused or acted on.
  const navigableIds = useMemo(
    () =>
      visibleCards
        .map((card) => card._id as string)
        .filter((cardId) => !isOptimisticCard(cardId)),
    [visibleCards]
  );
  const tabStopId =
    activeCardId !== null && navigableIds.includes(activeCardId)
      ? activeCardId
      : (navigableIds[0] ?? null);

  const focusCard = useCallback((element: HTMLElement) => {
    const cardId = element.dataset.cardId;
    if (cardId) {
      setActiveCardId(cardId);
    }
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "nearest" });
  }, []);

  // J or K with nothing focused (after a toast's Undo, say) goes back to
  // the grid's card. Arrows are left alone: they scroll the page.
  useKeyboardShortcuts(
    useMemo(() => {
      const nothingFocused = () =>
        document.activeElement === null ||
        document.activeElement === document.body;
      const enterGrid = () => {
        const element =
          tabStopId === null
            ? null
            : gridRef.current?.querySelector<HTMLElement>(
                `[data-card-id="${CSS.escape(tabStopId)}"]`
              );
        if (element) {
          focusCard(element);
        }
      };
      return [
        { keys: "j", run: enterGrid, when: nothingFocused },
        { keys: "k", run: enterGrid, when: nothingFocused },
      ];
    }, [focusCard, tabStopId])
  );

  // Shows the next batch, or asks for the next page, as scrolling would.
  const showMoreCards = useCallback(() => {
    if (visibleCount < filteredCards.length) {
      setVisibleCount((prev) =>
        Math.min(prev + normalizedBatchSizeRef.current, filteredCards.length)
      );
      return;
    }
    if (
      onLoadMoreRef.current &&
      hasMoreRef.current !== false &&
      !loadMoreRequestedRef.current
    ) {
      loadMoreRequestedRef.current = true;
      onLoadMoreRef.current();
    }
  }, [filteredCards.length, visibleCount]);

  useEffect(() => {
    const onFocusIn = (event: globalThis.FocusEvent) => {
      gridFocusedRef.current = Boolean(
        gridRef.current?.contains(event.target as Node)
      );
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!gridRef.current?.contains(event.target as Node)) {
        gridFocusedRef.current = false;
      }
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  // When the focused card leaves the grid (Delete, E, or F in Favorites),
  // focus moves to the card that took its place, so the keyboard never
  // drops back to the top of the page.
  useEffect(() => {
    if (activeCardId === null) {
      return;
    }
    const index = navigableIds.indexOf(activeCardId);
    if (index >= 0) {
      lastActiveIndexRef.current = index;
      return;
    }
    const fallbackId =
      navigableIds[
        Math.min(lastActiveIndexRef.current, navigableIds.length - 1)
      ];
    setActiveCardId(fallbackId ?? null);
    // The masonry removes the card's element after this render, so focus
    // may still be on it here, or already back on the page.
    const focused = document.activeElement;
    const focusLeft =
      focused === null ||
      focused === document.body ||
      (focused instanceof HTMLElement &&
        focused.dataset.cardId === activeCardId);
    if (fallbackId && gridFocusedRef.current && focusLeft) {
      const element = gridRef.current?.querySelector<HTMLElement>(
        `[data-card-id="${CSS.escape(fallbackId)}"]`
      );
      if (element) {
        focusCard(element);
      }
    }
  }, [activeCardId, focusCard, navigableIds]);

  // Closing the modal returns focus to the card it showed last (or the one
  // that opened it), as closing any dialog returns focus to its trigger.
  useEffect(() => {
    const previous = previousOpenCardIdRef.current;
    previousOpenCardIdRef.current = openCardId ?? null;
    if (!previous || openCardId || !openedFromGridRef.current) {
      return;
    }
    openedFromGridRef.current = false;
    // The modal animates out first; focus the card once it is gone, unless
    // focus has gone somewhere on purpose by then.
    let timer = 0;
    const startedAt = Date.now();
    const restore = () => {
      if (
        document.querySelector("[role='dialog']") &&
        Date.now() - startedAt < MODAL_CLOSE_WAIT_MS
      ) {
        timer = window.setTimeout(restore, 50);
        return;
      }
      const focused = document.activeElement;
      const element = gridRef.current?.querySelector<HTMLElement>(
        `[data-card-id="${CSS.escape(previous)}"]`
      );
      if (element && (focused === null || focused === document.body)) {
        focusCard(element);
      }
    };
    timer = window.setTimeout(restore, 0);
    return () => window.clearTimeout(timer);
  }, [focusCard, openCardId]);

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

  const cancelSelection = useCallback(() => {
    exitSelectionMode();
    if (addToFolder) {
      onAddToFolderDone?.(false);
    }
  }, [addToFolder, exitSelectionMode, onAddToFolderDone]);

  const handleCardClick = useCallback(
    (card: CardWithUrls & Record<string, unknown>) => {
      if (isSelectionMode) {
        toggleCardSelection(card._id);
      } else {
        openedFromGridRef.current = true;
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
        // Each card's folders before the action, so Undo restores them.
        const priorFolderIds = options.folder
          ? new Map(
              selectedCards.map((card) => [
                card._id as string,
                (card.folderIds ?? []) as string[],
              ])
            )
          : undefined;
        const { failedIds } = await onBulkAction(action, cardIds, {
          ...options,
          priorFolderIds,
        });
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
      selectedCards,
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

    for (const [index, card] of visibleCards.entries()) {
      items.push({
        data: card,
        isPriority: index < PRIORITY_CARD_COUNT,
        key: card._id,
      });
    }

    return items;
  }, [visibleCards, showTrashOnly, showAddForm, AddCardFormComponent]);

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
          isTabStop={card._id === tabStopId}
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
      tabStopId,
      toggleCardSelection,
    ]
  );

  const handleGridFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const cardId = (event.target as HTMLElement).dataset?.cardId;
    if (cardId) {
      setActiveCardId(cardId);
    }
  }, []);

  // Keys on a focused card: arrows and J/K move, F favorites, T adds tags,
  // E archives, Delete moves to Trash (asks to delete forever in Trash), X
  // selects and Esc leaves selection; with cards selected, F, T, E and
  // Delete act on the selection. Enter, Space and Cmd+C are the card's own.
  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const cardId = target.dataset?.cardId;
    if (
      !cardId ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const direction = GRID_DIRECTIONS[key];
    if (direction) {
      event.preventDefault();
      // Positions are read on each press: images loading and resizes
      // reflow the columns.
      const elements = Array.from(
        gridRef.current?.querySelectorAll<HTMLElement>("[data-card-id]") ?? []
      );
      const byId = new Map(
        elements.map((element) => [element.dataset.cardId, element])
      );
      const ordered = navigableIds.flatMap((id) => {
        const element = byId.get(id);
        return element ? [element] : [];
      });
      const index = ordered.indexOf(target);
      if (index < 0) {
        return;
      }
      const next = nextCardIndex(
        ordered.map((element) => element.getBoundingClientRect()),
        index,
        direction
      );
      const nextElement = ordered[next];
      if (next !== index && nextElement) {
        focusCard(nextElement);
      } else if (direction === "down" || direction === "next") {
        showMoreCards();
      }
      return;
    }
    if (event.repeat) {
      return;
    }
    const card = visibleCards.find((candidate) => candidate._id === cardId);
    if (!card) {
      return;
    }
    const isActionKey =
      key === "f" ||
      key === "t" ||
      key === "e" ||
      key === "Delete" ||
      key === "Backspace";
    // Choosing cards for a folder only picks them: no other card actions.
    if (addToFolder && isActionKey) {
      event.preventDefault();
      return;
    }
    // With cards selected, F, T, E and Delete act on all of them, like the
    // bar.
    const hasSelection =
      isSelectionMode && selectedCardIds.size > 0 && Boolean(onBulkAction);
    // Trash's bar has no Delete Forever for a selection, so neither do keys.
    if (hasSelection && showTrashOnly && isActionKey) {
      event.preventDefault();
      return;
    }
    if (hasSelection && !showTrashOnly) {
      let action: BulkCardAction | null = null;
      if (key === "f") {
        action = selectedCards.every((selected) => selected.isFavorited)
          ? "unfavorite"
          : "favorite";
      } else if (key === "e") {
        action = showArchivedOnly ? "unarchive" : "archive";
      } else if (key === "Delete" || key === "Backspace") {
        action = "delete";
      }
      if (action) {
        event.preventDefault();
        runBulk(action).catch(() => undefined);
        return;
      }
      if (key === "t") {
        event.preventDefault();
        handleBulkAction("addTags");
        return;
      }
    }
    if (key === "f" && !showTrashOnly && onToggleFavorite) {
      event.preventDefault();
      onToggleFavorite(cardId);
    } else if (key === "t" && !showTrashOnly && onAddTags) {
      event.preventDefault();
      onAddTags(cardId);
    } else if (key === "e" && !showTrashOnly && onToggleArchive) {
      event.preventDefault();
      onToggleArchive(cardId, !card.isArchived);
    } else if (key === "Delete" || key === "Backspace") {
      event.preventDefault();
      if (showTrashOnly) {
        requestPermanentDelete?.(cardId);
      } else {
        onDeleteCard(cardId).catch(() => undefined);
      }
    } else if (key === "x") {
      event.preventDefault();
      if (isSelectionMode) {
        toggleCardSelection(cardId);
      } else {
        enterSelectionMode(cardId);
      }
    } else if (key === "Escape" && isSelectionMode) {
      event.preventDefault();
      cancelSelection();
    }
  };

  const bulkActionBar: ReactNode =
    showBulkActions && onBulkAction && isSelectionMode ? (
      <BulkActionBar
        addToFolder={addToFolder}
        allFavorited={
          selectedCards.length > 0 &&
          selectedCards.every((selected) => selected.isFavorited)
        }
        folder={folder}
        isBusy={isBulkBusy}
        onAction={handleBulkAction}
        onCancel={cancelSelection}
        selectedCount={selectedCardIds.size}
        view={bulkView}
      />
    ) : null;

  return (
    <>
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: keys reach this wrapper from the focused card, which is the interactive element */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: as above */}
      <div
        onFocus={handleGridFocus}
        onKeyDown={handleGridKeyDown}
        ref={gridRef}
      >
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
