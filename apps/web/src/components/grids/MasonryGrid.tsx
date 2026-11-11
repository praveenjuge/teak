import type { Doc } from "@teak/convex/_generated/dataModel";
import { SEARCH_DEFAULT_CARD_LIMIT } from "@teak/convex/shared";
import type { BulkCardAction } from "@teak/convex/shared/bulkCardActions";
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
import { Card, cardElement, cardElements, cardIdOf } from "@/components/cards";
import { Spinner } from "@/components/ui/spinner";
import type {
  CardGridSource,
  GridCardAction,
  RunBulkCardAction,
} from "../../hooks/useCardActions";
import { useHydrated } from "../../hooks/useHydrated";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import {
  type BulkFolderTarget,
  collectCardLinks,
} from "../../lib/bulkCardActions";
import type {
  CardActionId,
  CardView,
  SelectionAction,
} from "../../lib/cardActions";
import type { CardGridLayout } from "../../lib/cardDensity";
import { nearestRemainingCardIds } from "../../lib/cardNeighbors";
import { copyText } from "../../lib/clipboard";
import type { FolderSummary } from "../../lib/folders";
import { gridKeyAction } from "../../lib/gridKeys";
import { nextCardIndex } from "../../lib/gridNavigation";
import {
  allFavorited,
  type CardOpenOrigin,
  isOptimisticCard,
} from "../cards/types";
import {
  BulkTagsDialog,
  CardFoldersDialog,
  EditLinkDialog,
  FolderPickerDialog,
} from "../lazyDialogs";
import { BulkActionBar, type BulkBarFolder } from "../selection/BulkActionBar";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { FirstPaintGrid } from "./FirstPaintGrid";
import {
  columnsForWidth,
  GRID_GUTTER,
  gridColumnsTemplate,
  MAX_COLUMNS,
  MIN_COLUMN_WIDTH,
} from "./gridColumns";
import { useBulkDeleteForever, useSelectAllCards } from "./gridSelection";

type MasonryCell = "add-form" | { card: Doc<"cards">; isPriority: boolean };
interface MasonryItem {
  data: MasonryCell;
  key: string;
}

/** Cards shown at first, and how many more each scroll to the end shows. */
const BATCH_SIZE = SEARCH_DEFAULT_CARD_LIMIT;
const COPY_LINKS_TOAST_ID = "copy-links";
const MEASURING_STYLE = {
  insetInline: 0,
  opacity: 0,
  pointerEvents: "none",
  position: "absolute",
  top: 0,
} as const;

const FALLBACK_COLUMNS = { xs: 1, sm: 2, md: 3, lg: 5, xl: 5, xxl: 5 };
/** How far below the screen the next cards start to load. */
const LOAD_MORE_ROOT_MARGIN = "200px 0px";
const PRIORITY_CARD_COUNT = 10;

// antd animates items in and out. Its motion forgets it has mounted while
// Next.js hides the page in <Activity>, so any re-render there (a card
// changing while Settings is open) unmounts every item, the composer
// included. Without motion the items stay mounted.
const STILL_MASONRY_THEME: ThemeConfig = { token: { motion: false } };

const sameOrder = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

export interface MasonryGridHandle {
  returnFocusTo: (cardId: string) => boolean;
}

const DEFAULT_LAYOUT: CardGridLayout = {
  gutter: GRID_GUTTER,
  maxColumns: MAX_COLUMNS,
  minColumnWidth: MIN_COLUMN_WIDTH,
};

export interface MasonryGridProps {
  /** The composer, first in the grid; none during a search or in Trash. */
  addCardForm?: ReactNode;
  addToFolder?: BulkBarFolder;
  filteredCards: Doc<"cards">[];
  folder?: BulkBarFolder;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  /** The gap, the most columns and the narrowest column: the card density. */
  layout?: CardGridLayout;
  onAddToFolderDone?: (added: boolean) => void;
  onBulkAction?: RunBulkCardAction;
  /** A card action from a card's menu (`grid`) or its key (`shortcut`). */
  onCardAction?: (
    action: GridCardAction,
    card: Doc<"cards">,
    source: CardGridSource
  ) => void;
  onCardClick: (card: CardWithUrls, origin?: CardOpenOrigin) => void;
  /** Deletes cards in Trash forever, once the person has confirmed. */
  onDeleteForever?: (
    cardIds: string[]
  ) => Promise<{ failedIds: readonly string[] }>;
  onLoadMore?: () => void;
  ref?: Ref<MasonryGridHandle>;
  /** Changes when the search does, which shows the first cards again. */
  resetKey: string;
  view?: CardView;
}

export const MasonryGrid = memo(function MasonryGrid({
  addToFolder,
  folder,
  onAddToFolderDone,
  filteredCards,
  view = "library",
  addCardForm,
  onCardAction,
  onCardClick,
  onBulkAction,
  onDeleteForever,
  ref,
  resetKey,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  layout = DEFAULT_LAYOUT,
}: MasonryGridProps) {
  const { gutter, maxColumns, minColumnWidth } = layout;
  const t = useTranslations("grids.masonry");
  const tDialog = useTranslations("cards.deleteForeverDialog");
  const inTrash = view === "trash";

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
    Math.min(BATCH_SIZE, filteredCards.length)
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
    if (!grid) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setMeasuredColumns(
          columnsForWidth(
            entry.contentRect.width,
            gutter,
            minColumnWidth,
            maxColumns
          )
        );
      }
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [gutter, maxColumns, minColumnWidth]);
  const resolvedColumns = measuredColumns ?? FALLBACK_COLUMNS;
  const hydrated = useHydrated();
  const [firstPaint, setFirstPaint] = useState(!hydrated);
  const endFirstPaint = useCallback(() => setFirstPaint(false), []);
  const loadMoreRequestedRef = useRef(false);
  const resetKeyRef = useRef(resetKey);
  const prevCardsLengthRef = useRef(filteredCards.length);

  const onLoadMoreRef = useRef(onLoadMore);
  const hasMoreRef = useRef(hasMore);

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    const didReset = resetKeyRef.current !== resetKey;
    if (didReset) {
      resetKeyRef.current = resetKey;
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

      const initialCount = Math.min(BATCH_SIZE, filteredCards.length);

      if (didReset || prev === 0) {
        return initialCount;
      }

      return Math.min(prev, filteredCards.length);
    });
  }, [resetKey, filteredCards.length]);

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
            Math.min(prev + BATCH_SIZE, filteredCards.length)
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
      { root: null, rootMargin: LOAD_MORE_ROOT_MARGIN, threshold: 0 }
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

  useSelectAllCards(isSelectionMode, navigableIds, setSelectedCardIds);

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
    const cardId = cardIdOf(element);
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
          tabStopId === null ? null : cardElement(gridRef.current, tabStopId);
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
        Math.min(prev + BATCH_SIZE, filteredCards.length)
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
      cardIdOf(focused) === activeCardId;
    if (fallbackId && gridFocusedRef.current && focusLeft) {
      const element = cardElement(gridRef.current, fallbackId);
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
        const { current, previous } = cardOrderRef.current;
        const element =
          cardElement(gridRef.current, cardId) ??
          nearestRemainingCardIds(previous, current, cardId)
            .map((id) => cardElement(gridRef.current, id))
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

  // Also keeps the cards a bulk action couldn't change selected, to retry.
  const enterSelectionMode = useCallback((...cardIds: string[]) => {
    setIsSelectionMode(true);
    if (cardIds.length > 0) {
      setSelectedCardIds(new Set(cardIds));
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
    (card: CardWithUrls, origin?: CardOpenOrigin) => {
      if (isSelectionMode) {
        toggleCardSelection(card._id);
      } else {
        openedFromGridRef.current = true;
        onCardClick(card, origin);
      }
    },
    [isSelectionMode, onCardClick, toggleCardSelection]
  );

  const runCardAction = useCallback(
    (action: CardActionId, card: Doc<"cards">, source: CardGridSource) => {
      if (action === "select") {
        if (isSelectionMode) {
          toggleCardSelection(card._id);
        } else {
          enterSelectionMode(card._id);
        }
      } else if (action === "deleteForever") {
        setPendingPermanentDeleteId(card._id);
      } else if (action !== "done" && action !== "copy") {
        // A card copies itself; done belongs to the open card.
        onCardAction?.(action, card, source);
      }
    },
    [enterSelectionMode, isSelectionMode, onCardAction, toggleCardSelection]
  );
  const handleMenuAction = useCallback(
    (action: CardActionId, card: CardWithUrls) =>
      runCardAction(action, card as unknown as Doc<"cards">, "grid"),
    [runCardAction]
  );

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
  const allSelectedFavorited = allFavorited(selectedCards);

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
          enterSelectionMode(...failedIds);
        }
      } finally {
        setIsBulkBusy(false);
      }
    },
    [
      addToFolder,
      enterSelectionMode,
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
        void runBulk("moveToFolder", {
          folder: {
            folderId: picked._id,
            folderName: picked.name,
            ...(folder
              ? { fromFolderId: folder.id, fromFolderName: folder.name }
              : {}),
          },
        });
        return;
      }
      void runBulk("addToFolder", {
        folder: { folderId: picked._id, folderName: picked.name },
      });
    },
    [folder, folderPickerMode, runBulk]
  );

  const bulkDeleteForever = useBulkDeleteForever((cardIds) => {
    exitSelectionMode();
    return onDeleteForever?.(cardIds);
  }, enterSelectionMode);
  const requestBulkDeleteForever = bulkDeleteForever.request;

  const handleBulkAction = useCallback(
    (action: SelectionAction) => {
      if (action === "deleteForever") {
        requestBulkDeleteForever(Array.from(selectedCardIds));
        return;
      }
      if (action === "addTags" || action === "removeTags") {
        setTagsDialogMode(action === "addTags" ? "add" : "remove");
        return;
      }
      if (action === "addToFolder" && addToFolder) {
        void runBulk("addToFolder", {
          folder: { folderId: addToFolder.id, folderName: addToFolder.name },
        });
        return;
      }
      if (action === "addToFolder" || action === "moveToFolder") {
        setFolderPickerMode(action === "addToFolder" ? "add" : "move");
        return;
      }
      if (action === "removeFromFolder") {
        if (folder) {
          void runBulk("removeFromFolder", {
            folder: { folderId: folder.id, folderName: folder.name },
          });
        }
        return;
      }
      if (action === "copyLinks") {
        const links = collectCardLinks(selectedCards);
        if (links.length === 0) {
          toast(t("noLinks"), { id: COPY_LINKS_TOAST_ID });
          return;
        }
        void copyText(
          links.join("\n"),
          {
            copied: t("copiedLinks", { count: links.length }),
            failed: t("copyLinksFailed"),
          },
          COPY_LINKS_TOAST_ID
        );
        return;
      }
      void runBulk(action);
    },
    [
      addToFolder,
      folder,
      requestBulkDeleteForever,
      runBulk,
      selectedCardIds,
      selectedCards,
      t,
    ]
  );

  const confirmPermanentDelete = useCallback(() => {
    if (pendingPermanentDeleteId) {
      void onDeleteForever?.([pendingPermanentDeleteId]);
    }
    setPendingPermanentDeleteId(null);
  }, [onDeleteForever, pendingPermanentDeleteId]);

  // "Remove from this folder" on one card, while its manual folder is open.
  const removeCardFromFolder = useMemo(() => {
    if (!(folder && onBulkAction)) {
      return;
    }
    // The item only shows on cards in this folder, which is all Undo needs.
    return (cardId: string) => {
      void onBulkAction("removeFromFolder", [cardId], {
        folder: { folderId: folder.id, folderName: folder.name },
        priorFolderIds: new Map([[cardId, [folder.id]]]),
      });
    };
  }, [folder, onBulkAction]);

  const masonryItems = useMemo(() => {
    const items: MasonryItem[] = [];

    if (addCardForm && !inTrash) {
      items.push({ key: "add-form", data: "add-form" });
    }

    for (const [index, card] of visibleCards.entries()) {
      items.push({
        data: { card, isPriority: index < PRIORITY_CARD_COUNT },
        key: card._id,
      });
    }

    return items;
  }, [visibleCards, inTrash, addCardForm]);

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
          onAction={handleMenuAction}
          onClick={handleCardClick}
          onEditFolders={setFoldersCardId}
          onEditLink={setEditLinkCardId}
          onRemoveFromFolder={
            removeCardFromFolder &&
            !card.isDeleted &&
            folder &&
            ((card.folderIds ?? []) as string[]).includes(folder.id)
              ? removeCardFromFolder
              : undefined
          }
        />
      );
    },
    [
      addCardForm,
      handleCardClick,
      handleMenuAction,
      removeCardFromFolder,
      folder,
      isSelectionMode,
      selectedCardIds,
      tabStopId,
    ]
  );

  const handleGridFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const cardId = cardIdOf(event.target as Element);
    if (cardId) {
      setActiveCardId(cardId);
    }
  }, []);

  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const cardId = cardIdOf(target);
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
    const card = visibleCards.find((candidate) => candidate._id === cardId);
    const action = gridKeyAction(
      event.key.length === 1 ? event.key.toLowerCase() : event.key,
      {
        addToFolder: Boolean(addToFolder),
        allSelectedFavorited,
        hasSelection:
          isSelectionMode && selectedCardIds.size > 0 && Boolean(onBulkAction),
        isSelectionMode,
        view,
      },
      card ?? {}
    );
    if (action?.type === "move") {
      event.preventDefault();
      const byId = cardElements(gridRef.current);
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
    if (!(action && card) || event.repeat) {
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
      event.preventDefault();
      runCardAction(action.action, card, "shortcut");
    }
  };

  const bulkActionBar: ReactNode =
    onBulkAction && isSelectionMode ? (
      <BulkActionBar
        addToFolder={addToFolder}
        allFavorited={allSelectedFavorited}
        folder={folder}
        isBusy={isBulkBusy}
        onAction={handleBulkAction}
        onCancel={cancelSelection}
        selectedCount={selectedCardIds.size}
        view={view}
      />
    ) : null;

  return (
    <>
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: keys reach this wrapper from the focused card, which is the interactive element */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: as above */}
      <div
        className={firstPaint ? "relative" : undefined}
        onFocus={handleGridFocus}
        onKeyDown={handleGridKeyDown}
        ref={gridRef}
      >
        {firstPaint ? (
          <FirstPaintGrid
            gridTemplateColumns={gridColumnsTemplate(
              gutter,
              minColumnWidth,
              maxColumns
            )}
            gutter={gutter}
            items={masonryItems}
            renderItem={renderItem}
          />
        ) : null}
        <ConfigProvider theme={STILL_MASONRY_THEME}>
          <Masonry
            className={isSelectionMode ? "select-none" : ""}
            columns={resolvedColumns}
            fresh
            gutter={gutter}
            itemRender={renderItem}
            items={masonryItems}
            onLayoutChange={firstPaint ? endFirstPaint : undefined}
            style={firstPaint ? MEASURING_STYLE : undefined}
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
          void runBulk(action, { tags });
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
      {bulkDeleteForever.dialog}
    </>
  );
});
