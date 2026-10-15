"use client";

import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { SEARCH_DEFAULT_CARD_LIMIT } from "@teak/convex/shared";
import { captureEvent } from "@teak/convex/shared/analytics";
import type { CardWithUrls } from "@teak/ui/cards";
import { Button } from "@teak/ui/components/ui/button";
import { CardsGridSkeleton } from "@teak/ui/feedback/CardsGridSkeleton";
import { VaultSetupState } from "@teak/ui/feedback/VaultSetupState";
import type { AddCardFormProps } from "@teak/ui/forms";
import { AddCardEmptyState, AddCardForm } from "@teak/ui/forms";
import { MasonryGrid, type MasonryGridHandle } from "@teak/ui/grids";
import {
  type CardsVisualFilters,
  useBulkCardActions,
  useCardActions,
  useCardClipboard,
  useCardModalFilterActions,
  useCardsSearchController,
  useVaultSetup,
} from "@teak/ui/hooks";
import { CardsSearchHeader } from "@teak/ui/search";
import { Authenticated, AuthLoading } from "convex/react";
import { usePaginatedQuery, useQuery } from "convex-helpers/react/cache/hooks";
import {
  Archive,
  Folder,
  FolderSearch,
  FolderX,
  Heart,
  type LucideIcon,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  LazyConnectedCardModal as ConnectedCardModal,
  preloadCardModal,
} from "../components/card-modal/LazyCardModal";
import { isOptimisticCard } from "../components/cards/types";
import { FolderDot } from "../components/folders/FolderDot";
import { SmartFolderQuery } from "../components/folders/SmartFolderQuery";
import {
  FolderNameDialog,
  preloadLibraryDialogs,
  TagManagementModal,
} from "../components/lazyDialogs";
import { useFolders } from "../hooks/useFolders";
import { useLoadUntilMatches } from "../hooks/useLoadUntilMatches";
import { getAdjacentCardIds } from "../lib/cardNeighbors";
import {
  buildSmartFolderQuery,
  FOLDER_ICON_CLASSES,
  type FolderSummary,
  manualFolders,
} from "../lib/folders";
import { whenIdle } from "../lib/lazyWithPreload";
import {
  LIBRARY_VIEW_LABELS,
  LIBRARY_VIEW_SEARCH_PLACEHOLDERS,
  type LibraryView,
} from "../lib/libraryViews";
import {
  parseSearchUrlState,
  type SearchUrlState,
} from "../lib/searchUrlState";
import {
  createSearchUrlSync,
  type SearchFromUrl,
  type SearchUrlChange,
} from "../lib/searchUrlSync";
import { PageTitle } from "./PageHeader";

const EMPTY_VIEW_COPY: Record<
  Exclude<LibraryView, "all">,
  { icon: LucideIcon; text: string }
> = {
  favorites: {
    icon: Heart,
    text: "No favorites yet. Favorite a card to find it here.",
  },
  archive: {
    icon: Archive,
    text: "Nothing archived. Archive a card to keep it out of your library.",
  },
  trash: { icon: Trash2, text: "Trash is empty." },
};

const clipName = (name: string) =>
  Array.from(name).length > 40
    ? `${Array.from(name).slice(0, 39).join("")}…`
    : name;

export type { SearchUrlChange } from "../lib/searchUrlSync";

interface CardsScreenProps {
  /**
   * Choosing cards for this folder (`?addTo=` on the library): the grid
   * opens in selection mode with "Add to <folder>" as its action.
   */
  addToFolderId?: string;
  contentContainerClassName?: string;
  /** A folder view: the folder id from the route, valid or not. */
  folderId?: string;
  headerLeading?: ReactNode;
  /** Filters to start with, kept from before a failed read was retried. */
  initialVisualFilters?: CardsVisualFilters;
  /** Starts choosing cards to add to an (empty) folder. */
  onAddCardsToFolder?: (folderId: string) => void;
  /** Leaves "choose cards for a folder", after adding or on Cancel. */
  onAddToFolderDone?: (folderId: string, added: boolean) => void;
  onCloseCard: () => void;
  /**
   * Called when the settled search changes, to mirror it into the URL.
   * `sortChanged` marks a deliberate change worth its own history entry.
   */
  onNavigateView?: (view: LibraryView) => void;
  onOpenCard: (cardId: string) => void;
  /** Opens a folder's view, such as a smart folder just saved. */
  onOpenFolder?: (folderId: string) => void;
  onSearchUrlStateChange?: (
    state: SearchUrlState,
    change: SearchUrlChange
  ) => void;
  /** Shows another card in the open dialog, for previous and next. */
  onSwitchCard?: (cardId: string) => void;
  onUpgrade?: AddCardFormProps["onUpgrade"];
  /** Called when the in-memory filters change, so a retry can keep them. */
  onVisualFiltersChange?: (filters: CardsVisualFilters) => void;
  queryRetryKey?: string;
  /** The search in the page URL; back and forward apply it. */
  searchUrlState?: SearchUrlState;
  selectedCardId: string | null;
  toastIdPrefix?: string;
  UpgradeLinkComponent?: AddCardFormProps["UpgradeLinkComponent"];
  upgradeUrl: string;
  /** The routed library view; quick commands navigate between views. */
  view?: LibraryView;
}

export function CardsScreen({
  addToFolderId,
  folderId,
  initialVisualFilters,
  onAddCardsToFolder,
  onAddToFolderDone,
  selectedCardId,
  onOpenCard,
  onCloseCard,
  onOpenFolder,
  onUpgrade,
  queryRetryKey,
  headerLeading,
  onNavigateView,
  view,
  UpgradeLinkComponent,
  upgradeUrl,
  contentContainerClassName,
  toastIdPrefix,
  searchUrlState,
  onSearchUrlStateChange,
  onSwitchCard,
  onVisualFiltersChange,
}: CardsScreenProps) {
  const [tagManagementCardId, setTagManagementCardId] = useState<string | null>(
    null
  );
  const [tagInput, setTagInput] = useState("");
  const draftContentRef = useRef("");
  const gridRef = useRef<MasonryGridHandle>(null);
  const returnFocusToGrid = useCallback(
    (cardId: string) => gridRef.current?.returnFocusTo(cardId) ?? false,
    []
  );
  const folder: FolderSummary | null | undefined = useQuery(
    api.folders.getFolder,
    folderId ? { folderId } : "skip"
  );
  const addToFolder: FolderSummary | null | undefined = useQuery(
    api.folders.getFolder,
    addToFolderId ? { folderId: addToFolderId } : "skip"
  );
  const isFolderView = Boolean(folderId);
  const isSmartFolder = folder?.kind === "smart";
  const gridAddToFolder = useMemo(
    () =>
      addToFolder ? { id: addToFolder._id, name: addToFolder.name } : undefined,
    [addToFolder]
  );
  const gridFolder = useMemo(
    () =>
      folder && !isSmartFolder
        ? { id: folder._id, name: folder.name }
        : undefined,
    [folder, isSmartFolder]
  );
  const vaultSetup = useVaultSetup();
  const searchController = useCardsSearchController({
    folderId: folder?._id,
    folderQuery: isSmartFolder ? (folder?.query ?? "") : undefined,
    initialUrlState: searchUrlState,
    initialVisualFilters,
    onNavigateView,
    view,
  });
  const { applyUrlState, urlState } = searchController;

  const [urlSync] = useState(() => createSearchUrlSync(searchUrlState));
  const showSearchFromUrl = useCallback(
    (search: SearchFromUrl | null) => {
      if (search) {
        applyUrlState(search.state, { keepSearch: search.keepSearch });
      }
    },
    [applyUrlState]
  );
  useEffect(() => {
    if (searchUrlState) {
      showSearchFromUrl(urlSync.urlReported(searchUrlState));
    }
  }, [searchUrlState, showSearchFromUrl, urlSync]);
  const urlDriven = searchUrlState !== undefined;
  const pagePathRef = useRef<string | null>(null);
  useEffect(() => {
    pagePathRef.current = window.location.pathname;
  });
  useEffect(() => {
    if (!urlDriven) {
      return;
    }
    const handlePopState = () => {
      if (window.location.pathname === pagePathRef.current) {
        showSearchFromUrl(
          urlSync.historyLanded(
            parseSearchUrlState(new URLSearchParams(window.location.search))
          )
        );
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [showSearchFromUrl, urlDriven, urlSync]);
  useEffect(() => {
    const change = urlSync.searchSettled(urlState);
    if (!change) {
      return;
    }
    if (change.sortChanged || change.typesChanged || change.tagChanged) {
      window.scrollTo({ top: 0 });
    }
    onSearchUrlStateChange?.(urlState, change);
  }, [onSearchUrlStateChange, urlState, urlSync]);

  const queryArgs = searchController.queryArgs;
  const searchKey = useMemo(() => JSON.stringify(queryArgs), [queryArgs]);
  const reportedSearchKeyRef = useRef<string | null>(null);
  const {
    results: cards,
    status: cardsStatus,
    loadMore,
  } = usePaginatedQuery(
    api.cards.searchCardsPaginated,
    isFolderView && !folder
      ? "skip"
      : { ...queryArgs, ...(queryRetryKey ? { retryKey: queryRetryKey } : {}) },
    { initialNumItems: SEARCH_DEFAULT_CARD_LIMIT }
  );

  const {
    addFilter,
    addKeywordTag,
    clearAllFilters,
    displayCards,
    filterTags,
    hasNoFilters,
    hasNoSearchFilters,
    hexFilters,
    hueFilters,
    resetKey,
    searchBarProps,
    searchTerms,
    setRemoteCards,
    showArchivedOnly,
    showTrashOnly,
    styleFilters,
    tagFilter,
    timeFilter,
    updateCachedCard,
  } = searchController;
  useEffect(() => {
    onVisualFiltersChange?.({
      hexFilters,
      hueFilters,
      styleFilters,
      timeFilter,
    });
  }, [hexFilters, hueFilters, onVisualFiltersChange, styleFilters, timeFilter]);
  const showVaultSetup =
    vaultSetup === "settingUp" &&
    hasNoFilters &&
    !isFolderView &&
    (!view || view === "all");

  const [folderDialog, setFolderDialog] = useState<
    | { mode: "save"; query: string }
    | { focusQuery: boolean; mode: "edit" }
    | null
  >(null);
  const saveableQuery = useMemo(
    () =>
      buildSmartFolderQuery({
        folder,
        tag: tagFilter,
        terms: searchTerms,
        types: filterTags,
        view,
      }),
    [filterTags, folder, searchTerms, tagFilter, view]
  );
  const hasUnsavableFilters =
    styleFilters.length > 0 ||
    hueFilters.length > 0 ||
    hexFilters.length > 0 ||
    timeFilter !== null;
  const allFolders = useFolders();
  const folderNames = useMemo(
    () =>
      allFolders === undefined
        ? undefined
        : new Set(
            manualFolders(allFolders).map((item) => item.name.toLowerCase())
          ),
    [allFolders]
  );
  const editSmartFolder = useCallback(
    () => setFolderDialog({ mode: "edit", focusQuery: true }),
    []
  );

  useEffect(() => {
    setRemoteCards(cards, searchKey);
  }, [cards, searchKey, setRemoteCards]);

  const { isSeekingFirstMatch, requestMore: requestMoreCards } =
    useLoadUntilMatches({
      count: cards.length,
      loadMore,
      pageSize: SEARCH_DEFAULT_CARD_LIMIT,
      status: cardsStatus,
    });

  useEffect(() => {
    if (
      !searchController.hasActiveSearch ||
      cardsStatus === "LoadingFirstPage" ||
      isSeekingFirstMatch ||
      reportedSearchKeyRef.current === searchKey
    ) {
      return;
    }
    reportedSearchKeyRef.current = searchKey;
    captureEvent("search_performed", { zero_result: cards.length === 0 });
  }, [
    cards.length,
    cardsStatus,
    isSeekingFirstMatch,
    searchController.hasActiveSearch,
    searchKey,
  ]);

  const hasCards = displayCards.length > 0;
  useEffect(() => {
    if (!hasCards) {
      return;
    }
    return whenIdle(() => {
      preloadCardModal().catch(() => undefined);
      preloadLibraryDialogs().catch(() => undefined);
    });
  }, [hasCards]);

  const selectedCard = useMemo(
    () =>
      displayCards.find((card: Doc<"cards">) => card._id === selectedCardId) ??
      null,
    [displayCards, selectedCardId]
  );

  const { previous: previousCardId, next: nextCardId } = useMemo(
    () =>
      getAdjacentCardIds(
        displayCards
          .map((card: Doc<"cards">) => card._id as string)
          .filter((id: string) => !isOptimisticCard(id)),
        selectedCardId
      ),
    [displayCards, selectedCardId]
  );

  const cardActions = useCardActions({
    onDeleteSuccess: (message?: string) => message && toast(message),
    onRestoreSuccess: (message?: string) => message && toast(message),
    onPermanentDeleteSuccess: (message?: string) => message && toast(message),
    onError: (_error: Error, operation: string) => {
      toast.error(
        `Failed to ${operation === "update removeAiTag" ? "remove tag" : operation}`
      );
    },
    onCardUpdate: updateCachedCard,
  });

  const runBulkAction = useBulkCardActions(toastIdPrefix);
  const handleToggleArchive = useCallback(
    (cardId: string, archive: boolean) => {
      runBulkAction(archive ? "archive" : "unarchive", [cardId]).catch(
        () => undefined
      );
    },
    [runBulkAction]
  );

  const handleToggleFavorite = useCallback(
    (cardId: string) => {
      const card = displayCards.find(
        (candidate: Doc<"cards">) => candidate._id === cardId
      );
      runBulkAction(card?.isFavorited ? "unfavorite" : "favorite", [cardId], {
        silent: true,
      }).catch(() => undefined);
    },
    [displayCards, runBulkAction]
  );

  const tagManagementCard = useMemo(
    () =>
      displayCards.find(
        (card: Doc<"cards">) => card._id === tagManagementCardId
      ) ?? null,
    [displayCards, tagManagementCardId]
  );

  const handleAddTags = useCallback((cardId: string) => {
    setTagManagementCardId(cardId);
  }, []);

  const { handleCopyImage } = useCardClipboard();

  const handleAddTag = useCallback(() => {
    const tag = tagInput.trim().toLowerCase();
    const currentTags = tagManagementCard?.tags || [];

    if (tag && !currentTags.includes(tag) && tagManagementCardId) {
      void cardActions.updateField(tagManagementCardId as Id<"cards">, "tags", [
        ...currentTags,
        tag,
      ]);
      setTagInput("");
    }
  }, [cardActions, tagInput, tagManagementCard?.tags, tagManagementCardId]);

  const handleRemoveTag = useCallback(
    (tagToRemove: string) => {
      const currentTags = tagManagementCard?.tags || [];
      const newTags = currentTags.filter((tag: string) => tag !== tagToRemove);

      if (tagManagementCardId) {
        void cardActions.updateField(
          tagManagementCardId as Id<"cards">,
          "tags",
          newTags.length > 0 ? newTags : undefined
        );
      }
    },
    [cardActions, tagManagementCard?.tags, tagManagementCardId]
  );

  const handleRemoveAiTag = useCallback(
    (tagToRemove: string) => {
      if (tagManagementCardId) {
        void cardActions.updateField(
          tagManagementCardId as Id<"cards">,
          "removeAiTag",
          undefined,
          tagToRemove
        );
      }
    },
    [cardActions, tagManagementCardId]
  );

  const handleCardClick = useCallback(
    (card: CardWithUrls & Record<string, unknown>) => {
      onOpenCard(card._id);
    },
    [onOpenCard]
  );

  const { handleCardTypeClick, handleTagClick } = useCardModalFilterActions({
    addFilter,
    addKeywordTag,
    onCloseModal: onCloseCard,
  });

  const handleInvalidSelectedCard = useCallback(() => {
    onCloseCard();
    toast.error("Card not found");
  }, [onCloseCard]);

  const addCardForm = useMemo(
    () => (
      <AddCardForm
        draftContentRef={draftContentRef}
        onUpgrade={onUpgrade}
        UpgradeLinkComponent={UpgradeLinkComponent}
        upgradeUrl={upgradeUrl}
      />
    ),
    [UpgradeLinkComponent, onUpgrade, upgradeUrl]
  );

  const renderEmptyState = () => {
    if (isFolderView && folder === null) {
      return (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <FolderX aria-hidden="true" className="size-4" />
          </span>
          <div className="space-y-1">
            <p className="font-medium">Folder not found</p>
            <p className="text-muted-foreground text-sm">
              It may have been deleted.
            </p>
          </div>
          {onNavigateView && (
            <Button onClick={() => onNavigateView("all")} variant="outline">
              Go to Everything
            </Button>
          )}
        </div>
      );
    }

    if (
      (isFolderView && folder === undefined) ||
      cardsStatus === "LoadingFirstPage" ||
      isSeekingFirstMatch ||
      searchController.isSearchPending
    ) {
      return <CardsGridSkeleton />;
    }

    if (isSmartFolder && displayCards.length === 0 && hasNoSearchFilters) {
      return (
        <div className="flex flex-col items-center gap-3 py-24 text-center text-muted-foreground">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted">
            <FolderSearch aria-hidden="true" className="size-4" />
          </span>
          <p>No cards match this smart folder.</p>
          <Button onClick={editSmartFolder} variant="outline">
            <Pencil />
            Edit search
          </Button>
        </div>
      );
    }

    if (folder && displayCards.length === 0 && hasNoSearchFilters) {
      return (
        <div className="flex flex-col items-center gap-3 py-24 text-center text-muted-foreground">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted">
            <Folder aria-hidden="true" className="size-4" />
          </span>
          <p>No cards in this folder yet.</p>
          {onAddCardsToFolder && (
            <Button
              onClick={() => onAddCardsToFolder(folder._id)}
              variant="outline"
            >
              <Plus />
              Add cards
            </Button>
          )}
        </div>
      );
    }

    let emptyView: Exclude<LibraryView, "all"> | null = null;
    if (view && view !== "all") {
      emptyView = view;
    } else if (showArchivedOnly) {
      emptyView = "archive";
    }
    if (displayCards.length === 0 && emptyView && hasNoSearchFilters) {
      const { icon: Icon, text } = EMPTY_VIEW_COPY[emptyView];
      return (
        <div className="flex flex-col items-center gap-3 py-24 text-center text-muted-foreground">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted">
            <Icon aria-hidden="true" className="size-4" />
          </span>
          <p>{text}</p>
        </div>
      );
    }

    if (displayCards.length === 0 && hasNoFilters) {
      // Until a new account's cards land, show them on their way rather
      // than an empty library. Cards that have arrived reach the grid an
      // effect later, so they are on their way too: an empty library here
      // would mount its composer and take focus for that one render.
      if (vaultSetup === "loading" || cards.length > 0) {
        return <CardsGridSkeleton />;
      }
      return (
        <AddCardEmptyState
          UpgradeLinkComponent={UpgradeLinkComponent}
          upgradeUrl={upgradeUrl}
        />
      );
    }

    if (displayCards.length === 0) {
      return (
        <div className="space-y-4 py-12 text-center">
          <p className="text-muted-foreground">
            Nothing found matching your filters
          </p>
          <Button onClick={clearAllFilters} variant="outline">
            Clear filters
          </Button>
        </div>
      );
    }

    return null;
  };

  let title: ReactNode = (
    <PageTitle>{LIBRARY_VIEW_LABELS[view ?? "all"]}</PageTitle>
  );
  if (isFolderView) {
    if (folder && isSmartFolder) {
      title = (
        <PageTitle
          icon={
            <FolderSearch
              aria-hidden="true"
              className={
                folder.color
                  ? `size-4 shrink-0 ${FOLDER_ICON_CLASSES[folder.color]}`
                  : "size-4 shrink-0 text-muted-foreground"
              }
            />
          }
          trailing={
            <Button
              aria-label="Edit search"
              className="size-7 shrink-0 text-muted-foreground"
              onClick={editSmartFolder}
              size="icon"
              title="Edit search"
              variant="ghost"
            >
              <Pencil className="size-3.5" />
            </Button>
          }
        >
          <span title={folder.name}>{folder.name}</span>
          <span className="sr-only"> (smart folder)</span>
        </PageTitle>
      );
    } else if (folder) {
      title = (
        <PageTitle
          count={
            <>
              {folder.activeCardCount.toLocaleString()}
              <span className="sr-only">
                {folder.activeCardCount === 1 ? " card" : " cards"}
              </span>
            </>
          }
          icon={<FolderDot className="size-2" color={folder.color} />}
        >
          <span title={folder.name}>{folder.name}</span>
        </PageTitle>
      );
    } else {
      title = <PageTitle>Folder</PageTitle>;
    }
  }

  const content = (
    <>
      <CardsSearchHeader
        {...searchBarProps}
        leading={headerLeading}
        lockedChips={
          folder && isSmartFolder ? (
            <SmartFolderQuery
              className="max-w-[45%] shrink-0"
              folderNames={folderNames}
              inline
              query={folder.query ?? ""}
            />
          ) : undefined
        }
        onSaveSearch={
          saveableQuery === null
            ? undefined
            : () => setFolderDialog({ mode: "save", query: saveableQuery })
        }
        placeholder={
          folder
            ? `Search ${clipName(folder.name)}`
            : LIBRARY_VIEW_SEARCH_PLACEHOLDERS[view ?? "all"]
        }
        title={title}
      />

      {showVaultSetup && <VaultSetupState />}

      {!showVaultSetup && displayCards.length > 0 && (
        <MasonryGrid
          addCardForm={addCardForm}
          addToFolder={gridAddToFolder}
          batchSize={SEARCH_DEFAULT_CARD_LIMIT}
          filteredCards={displayCards}
          folder={gridFolder}
          hasMore={
            cardsStatus === "CanLoadMore" || cardsStatus === "LoadingMore"
          }
          initialBatchSize={SEARCH_DEFAULT_CARD_LIMIT}
          isLoadingMore={cardsStatus === "LoadingMore"}
          onAddTags={handleAddTags}
          onAddToFolderDone={(added) => {
            if (addToFolder) {
              onAddToFolderDone?.(addToFolder._id, added);
            }
          }}
          onBulkAction={runBulkAction}
          onCardClick={handleCardClick}
          onCopyImage={handleCopyImage}
          onDeleteCard={async (cardId) => {
            const { failedIds } = await runBulkAction("delete", [cardId]);
            return failedIds.length === 0;
          }}
          onLoadMore={requestMoreCards}
          onPermanentDeleteCard={(cardId) =>
            cardActions.handlePermanentDeleteCard(cardId as Id<"cards">)
          }
          onRestoreCard={(cardId) =>
            cardActions.handleRestoreCard(cardId as Id<"cards">)
          }
          onToggleArchive={handleToggleArchive}
          onToggleFavorite={handleToggleFavorite}
          ref={gridRef}
          resetKey={resetKey}
          showAddForm={
            !(
              showTrashOnly ||
              showArchivedOnly ||
              view === "favorites" ||
              isFolderView
            )
          }
          showArchivedOnly={showArchivedOnly}
          showBulkActions={true}
          showTrashOnly={showTrashOnly}
          toastIdPrefix={toastIdPrefix}
        />
      )}

      {!showVaultSetup && displayCards.length === 0 && (
        <>
          <AuthLoading>
            <CardsGridSkeleton />
          </AuthLoading>
          <Authenticated>{renderEmptyState()}</Authenticated>
        </>
      )}

      <ConnectedCardModal
        card={selectedCard}
        cardId={selectedCardId}
        onCancel={onCloseCard}
        onCardTypeClick={handleCardTypeClick}
        onCardUpdate={updateCachedCard}
        onInvalidCard={handleInvalidSelectedCard}
        onNext={
          onSwitchCard && nextCardId
            ? () => onSwitchCard(nextCardId)
            : undefined
        }
        onPrevious={
          onSwitchCard && previousCardId
            ? () => onSwitchCard(previousCardId)
            : undefined
        }
        onTagClick={handleTagClick}
        open={!!selectedCardId}
        returnFocus={returnFocusToGrid}
      />

      <FolderNameDialog
        focusQuery={folderDialog?.mode === "edit" && folderDialog.focusQuery}
        folder={folderDialog?.mode === "edit" ? folder : null}
        onOpenChange={(open) => {
          if (!open) {
            setFolderDialog(null);
          }
        }}
        onSaved={(saved) => {
          if (folderDialog?.mode !== "save") {
            return;
          }
          toast.success(`Saved “${saved.name}”`, {
            description: "It shows every card that matches, as you save them.",
            ...(onOpenFolder
              ? {
                  action: {
                    label: "Open",
                    onClick: () => onOpenFolder(saved._id),
                  },
                }
              : {}),
          });
        }}
        open={folderDialog !== null}
        query={folderDialog?.mode === "save" ? folderDialog.query : undefined}
        queryNote={
          folderDialog?.mode === "save" && hasUnsavableFilters
            ? "Colors, styles and dates aren't saved in a smart folder."
            : undefined
        }
      />

      <TagManagementModal
        aiTags={tagManagementCard?.aiTags || []}
        onAddTag={handleAddTag}
        onOpenChange={(open) => !open && setTagManagementCardId(null)}
        onRemoveAiTag={handleRemoveAiTag}
        onRemoveTag={handleRemoveTag}
        open={!!tagManagementCardId}
        setTagInput={setTagInput}
        tagInput={tagInput}
        userTags={tagManagementCard?.tags || []}
      />
    </>
  );

  return (
    <div className="relative">
      {contentContainerClassName ? (
        <main className={contentContainerClassName}>{content}</main>
      ) : (
        content
      )}
    </div>
  );
}
