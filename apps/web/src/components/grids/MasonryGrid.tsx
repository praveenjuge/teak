import type { Doc } from "@teak/convex/_generated/dataModel";
import { useTranslations } from "@teak/i18n/react";
import { ConfigProvider, Masonry, type ThemeConfig } from "antd";
import type { FocusEvent, KeyboardEvent, ReactNode, Ref } from "react";
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import type { CardWithUrls } from "@/components/cards";
import { Card } from "@/components/cards";
import { Spinner } from "@/components/ui/spinner";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import {
  type BulkCardAction,
  type BulkFolderTarget,
  collectCardLinks,
} from "../../lib/bulkCardActions";
import type { FolderSummary } from "../../lib/folders";
import { type GridCardKeyAction, gridKeyAction } from "../../lib/gridKeys";
import { nextCardIndex } from "../../lib/gridNavigation";
import { isOptimisticCard } from "../cards/types";
import {
  BulkTagsDialog,
  CardFoldersDialog,
  EditLinkDialog,
  FolderPickerDialog,
} from "../lazyDialogs";
import {
  BulkActionBar,
  type BulkBarAction,
  type BulkBarFolder,
  type BulkBarView,
} from "../selection/BulkActionBar";
import { ConfirmDialog } from "../ui/confirm-dialog";

type MasonryCell = "add-form" | { card: Doc<"cards">; isPriority: boolean };
interface MasonryItem {
  data: MasonryCell;
  key: string;
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

export const columnsForWidth = (width: number, gutter: number): number =>
  Math.min(
    MAX_COLUMNS,
    Math.max(1, Math.floor((width + gutter) / (MIN_COLUMN_WIDTH + gutter)))
  );

const FALLBACK_COLUMNS = { xs: 1, sm: 2, md: 3, lg: 5, xl: 5, xxl: 5 };
const DEFAULT_ROOT_MARGIN = "200px 0px";
const PRIORITY_CARD_COUNT = 10;

// antd animates items in and out. Its motion forgets it has mounted while
// Next.js hides the page in <Activity>, so any re-render there (a card
// changing while Settings is open) unmounts every item, the composer
// included. Without motion the items stay mounted.
const STILL_MASONRY_THEME: ThemeConfig = { token: { motion: false } };

/**
 * The cards still in the grid next to one that left it, nearest first: the
 * ones after it, then the ones before it.
 */
export function neighborOf(
  cardId: string,
  order: { current: readonly string[]; previous: readonly string[] }
): string[] {
  const index = order.previous.indexOf(cardId);
  if (index < 0) {
    return [];
  }
  const remaining = new Set(order.current);
  return [
    ...order.previous.slice(index + 1),
    ...order.previous.slice(0, index).reverse(),
  ].filter((id) => remaining.has(id));
}

const sameOrder = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

export interface MasonryGridHandle {
  returnFocusTo: (cardId: string) => boolean;
}

export interface MasonryGridProps {
  addCardForm?: ReactNode;
  addToFolder?: BulkBarFolder;
  batchSize?: number;
  columns?: MasonryColumns;
  filteredCards: Doc<"cards">[];
  folder?: BulkBarFolder;
  gutter?: number;
  hasMore?: boolean;
  initialBatchSize?: number;
  isLoadingMore?: boolean;
  loadMoreRootMargin?: string;
  onAddTags?: (cardId: string) => void;
  onAddToFolderDone?: (added: boolean) => void;
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
  ref?: Ref<MasonryGridHandle>;
  resetKey?: string | number | boolean;
  showAddForm?: boolean;
  showArchivedOnly?: boolean;
  showBulkActions?: boolean;
  showTrashOnly?: boolean;
  toastIdPrefix?: string;
}

export const MasonryGrid = memo(function MasonryGrid({
  addToFolder,
  folder,
  onAddToFolderDone,
  filteredCards,
  showTrashOnly = false,
  showArchivedOnly = false,
  showAddForm = false,
  showBulkActions = true,
  addCardForm,
  onCardClick,
  onDeleteCard,
  onBulkAction,
  onRestoreCard,
  onPermanentDeleteCard,
  onToggleArchive,
  onToggleFavorite,
  onAddTags,
  onCopyImage,
  ref,
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
  const t = useTranslations("grids.masonry");
  const tDialog = useTranslations("cards.deleteForeverDialog");
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
  const [editLinkCardId, setEditLinkCardId] = useState<string | null>(null);
  const keepSelectionMode = Boolean(addToFolder);
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
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const gridFocusedRef = useRef(false);
  const lastActiveIndexRef = useRef(0);
  const openedFromGridRef = useRef<boolean>(false);
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

  // A finished page clears the request even when it showed no new cards: a
  // search merges cached cards with the server's pages, so a page of cards
  // already on screen leaves the count unchanged.
  const wasLoadingMoreRef = useRef(isLoadingMore);
  useEffect(() => {
    if (wasLoadingMoreRef.current && !isLoadingMore) {
      loadMoreRequestedRef.current = false;
    }
    wasLoadingMoreRef.current = isLoadingMore;
  }, [isLoadingMore]);

  useEffect(() => {
    const canGrow = visibleCount < filteredCards.length || hasMore !== false;
    const sentinel = loadMoreRef.current;
    if (!(sentinel && canGrow)) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        // IntersectionObserver can batch several reports into one callback, oldest
        // first; only the newest says where the sentinel is now.
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
        if (
          canLoadMoreRemote &&
          !isLoadingMore &&
          !loadMoreRequestedRef.current
        ) {
          loadMoreRequestedRef.current = true;
          onLoadMoreRef.current?.();
        }
      },
      { root: null, rootMargin: loadMoreRootMarginRef.current, threshold: 0 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
    // A settled page re-observes, so a sentinel still in view reports again
    // and asks for the next page.
  }, [visibleCount, filteredCards.length, hasMore, isLoadingMore]);

  const visibleCards = useMemo(
    () => filteredCards.slice(0, visibleCount),
    [filteredCards, visibleCount]
  );
  const navigableIds = useMemo(
    () =>
      visibleCards
        .map((card) => card._id as string)
        .filter((cardId) => !isOptimisticCard(cardId)),
    [visibleCards]
  );
  // The order before the last change too, so focus can find where a card
  // that just left (deleted from its dialog) used to be.
  const cardOrderRef = useRef<{ current: string[]; previous: string[] }>({
    current: [],
    previous: [],
  });
  // Recorded after commit, so a render React throws away never counts.
  useLayoutEffect(() => {
    if (!sameOrder(cardOrderRef.current.current, navigableIds)) {
      cardOrderRef.current = {
        current: navigableIds,
        previous: cardOrderRef.current.current,
      };
    }
  }, [navigableIds]);
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
    // antd's masonry removes the card's element after this render, so focus
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

  useImperativeHandle(
    ref,
    () => ({
      returnFocusTo: (cardId: string) => {
        if (!openedFromGridRef.current) {
          return false;
        }
        openedFromGridRef.current = false;
        const findCard = (id: string) =>
          gridRef.current?.querySelector<HTMLElement>(
            `[data-card-id="${CSS.escape(id)}"]`
          ) ?? null;
        const element =
          findCard(cardId) ??
          neighborOf(cardId, cardOrderRef.current)
            .map(findCard)
            .find((found) => found !== null);
        if (!element) {
          return false;
        }
        focusCard(element);
        return true;
      },
    }),
    [focusCard]
  );

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

  const editLinkCard = useMemo(() => {
    const card = filteredCards.find(({ _id }) => _id === editLinkCardId);
    return card?.url ? { id: card._id, url: card.url } : null;
  }, [editLinkCardId, filteredCards]);

  const selectedCards = useMemo(
    () => filteredCards.filter((card) => selectedCardIds.has(card._id)),
    [filteredCards, selectedCardIds]
  );

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
          toast(t("noLinks"), {
            id: `${toastIdPrefix}-copy-links`,
          });
          return;
        }
        navigator.clipboard
          .writeText(links.join("\n"))
          .then(() =>
            toast.success(t("copiedLinks", { count: links.length }), {
              id: `${toastIdPrefix}-copy-links`,
            })
          )
          .catch(() =>
            toast.error(t("copyLinksFailed"), {
              id: `${toastIdPrefix}-copy-links`,
            })
          );
        return;
      }
      runBulk(action).catch(() => undefined);
    },
    [addToFolder, folder, runBulk, selectedCards, t, toastIdPrefix]
  );

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

  const masonryItems = useMemo(() => {
    const items: MasonryItem[] = [];

    if (showAddForm && !showTrashOnly && addCardForm) {
      items.push({ key: "add-form", data: "add-form" });
    }

    for (const [index, card] of visibleCards.entries()) {
      items.push({
        data: { card, isPriority: index < PRIORITY_CARD_COUNT },
        key: card._id,
      });
    }

    return items;
  }, [visibleCards, showTrashOnly, showAddForm, addCardForm]);

  const renderItem = useCallback(
    ({ data }: Pick<MasonryItem, "data">) => {
      if (data === "add-form") {
        return addCardForm;
      }

      const { card, isPriority } = data;
      return (
        <Card
          card={card}
          isPriority={isPriority}
          isSelected={selectedCardIds.has(card._id)}
          isSelectionMode={isSelectionMode}
          isTabStop={card._id === tabStopId}
          isTrashMode={showTrashOnly}
          onAddTags={onAddTags}
          onClick={handleCardClick}
          onCopyImage={onCopyImage}
          onDelete={onDeleteCard}
          onEditFolders={setFoldersCardId}
          onEditLink={setEditLinkCardId}
          onEnterSelectionMode={enterSelectionMode}
          onPermanentDelete={requestPermanentDelete}
          onRestore={onRestoreCard}
          onToggleArchive={onToggleArchive}
          onToggleFavorite={onToggleFavorite}
          onToggleSelection={toggleCardSelection}
        />
      );
    },
    [
      addCardForm,
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
    const action = gridKeyAction(
      event.key.length === 1 ? event.key.toLowerCase() : event.key,
      {
        addToFolder: Boolean(addToFolder),
        allSelectedFavorited: selectedCards.every(
          (selected) => selected.isFavorited
        ),
        hasSelection:
          isSelectionMode && selectedCardIds.size > 0 && Boolean(onBulkAction),
        isSelectionMode,
        view: bulkView,
      }
    );
    if (action?.type === "move") {
      event.preventDefault();
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
        action.direction
      );
      const nextElement = ordered[next];
      if (next !== index && nextElement) {
        focusCard(nextElement);
      } else if (action.direction === "down" || action.direction === "next") {
        showMoreCards();
      }
      return;
    }
    if (!action || event.repeat) {
      return;
    }
    const card = visibleCards.find((candidate) => candidate._id === cardId);
    if (!card) {
      return;
    }
    if (action.type === "blocked") {
      event.preventDefault();
    } else if (action.type === "selection") {
      event.preventDefault();
      handleBulkAction(action.action);
    } else if (action.type === "cancelSelection") {
      event.preventDefault();
      cancelSelection();
    } else {
      runCardKeyAction(event, action.action, card);
    }
  };

  const runCardKeyAction = (
    event: KeyboardEvent<HTMLDivElement>,
    action: GridCardKeyAction,
    card: Doc<"cards">
  ) => {
    const handlers: Record<GridCardKeyAction, (() => void) | undefined> = {
      addTags: onAddTags && (() => onAddTags(card._id)),
      archive:
        onToggleArchive && (() => onToggleArchive(card._id, !card.isArchived)),
      delete: () => {
        onDeleteCard(card._id).catch(() => undefined);
      },
      deleteForever: () => requestPermanentDelete?.(card._id),
      favorite: onToggleFavorite && (() => onToggleFavorite(card._id)),
      select: () => {
        if (isSelectionMode) {
          toggleCardSelection(card._id);
        } else {
          enterSelectionMode(card._id);
        }
      },
    };
    const run = handlers[action];
    if (run) {
      event.preventDefault();
      run();
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
        <ConfigProvider theme={STILL_MASONRY_THEME}>
          <Masonry
            className={isSelectionMode ? "select-none" : ""}
            columns={resolvedColumns}
            fresh
            gutter={gutter}
            itemRender={renderItem}
            items={masonryItems}
          />
        </ConfigProvider>
      </div>
      {filteredCards.length > 0 &&
        (visibleCount < filteredCards.length ||
          (onLoadMore && hasMore !== false)) && (
          <div aria-hidden="true" className="h-10 w-full" ref={loadMoreRef} />
        )}
      {isLoadingMore ? (
        <div className="flex justify-center py-6">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      ) : null}
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
      <EditLinkDialog
        card={editLinkCard}
        onOpenChange={(open) => {
          if (!open) {
            setEditLinkCardId(null);
          }
        }}
        open={editLinkCard !== null}
      />
      <ConfirmDialog
        confirmLabel={tDialog("confirm")}
        description={tDialog("description")}
        onConfirm={confirmPermanentDelete}
        onOpenChange={(open) => {
          if (!open) {
            setPendingPermanentDeleteId(null);
          }
        }}
        open={pendingPermanentDeleteId !== null}
        title={tDialog("title")}
      />
    </>
  );
});
