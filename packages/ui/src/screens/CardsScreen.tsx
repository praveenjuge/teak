"use client";

import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { SEARCH_DEFAULT_CARD_LIMIT } from "@teak/convex/shared";
import { captureEvent } from "@teak/convex/shared/analytics";
import { ConnectedCardModal } from "@teak/ui/card-modal";
import type { CardWithUrls } from "@teak/ui/cards";
import { Button } from "@teak/ui/components/ui/button";
import { CardsGridSkeleton } from "@teak/ui/feedback/CardsGridSkeleton";
import type { AddCardFormProps } from "@teak/ui/forms";
import { AddCardEmptyState, AddCardForm } from "@teak/ui/forms";
import { MasonryGrid } from "@teak/ui/grids";
import {
  useBulkCardActions,
  useCardActions,
  useCardClipboard,
  useCardModalFilterActions,
  useCardsSearchController,
} from "@teak/ui/hooks";
import { TagManagementModal } from "@teak/ui/modals";
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
import { FolderDot } from "../components/folders/FolderDot";
import { FolderNameDialog } from "../components/folders/FolderNameDialog";
import { SmartFolderQuery } from "../components/folders/SmartFolderQuery";
import { useFolders } from "../hooks/useFolders";
import {
  buildSmartFolderQuery,
  FOLDER_ICON_CLASSES,
  type FolderSummary,
  manualFolders,
} from "../lib/folders";
import type { LibraryView } from "../lib/libraryViews";
import {
  isSameSearchUrlState,
  type SearchUrlState,
} from "../lib/searchUrlState";

/** What a routed view shows when it has no cards and nothing narrows it. */
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

const SEARCH_PLACEHOLDERS: Record<LibraryView, string> = {
  all: "Search for anything...",
  favorites: "Search favorites...",
  archive: "Search the archive...",
  trash: "Search Trash...",
};

/** A folder name short enough for the search placeholder. */
const clipName = (name: string) =>
  Array.from(name).length > 40
    ? `${Array.from(name).slice(0, 39).join("")}…`
    : name;

/** A change worth its own history entry: a new sort or new card types. */
export interface SearchUrlChange {
  sortChanged: boolean;
  /** The sidebar tag was picked or cleared. */
  tagChanged: boolean;
  typesChanged: boolean;
}

interface CardsScreenProps {
  /**
   * Choosing cards for this folder (`?addTo=` on the library): the grid
   * opens in selection mode with "Add to <folder>" as its action.
   */
  addToFolderId?: string;
  contentContainerClassName?: string;
  /** A folder view: the folder id from the route, valid or not. */
  folderId?: string;
  /** Shown before the search box, such as the sidebar toggle. */
  headerLeading?: ReactNode;
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
  onUpgrade?: AddCardFormProps["onUpgrade"];
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
  onAddCardsToFolder,
  onAddToFolderDone,
  selectedCardId,
  onOpenCard,
  onCloseCard,
  onOpenFolder,
  onUpgrade,
  headerLeading,
  onNavigateView,
  view,
  UpgradeLinkComponent,
  upgradeUrl,
  contentContainerClassName,
  toastIdPrefix,
  searchUrlState,
  onSearchUrlStateChange,
}: CardsScreenProps) {
  const [tagManagementCardId, setTagManagementCardId] = useState<string | null>(
    null
  );
  const [tagInput, setTagInput] = useState("");
  const draftContentRef = useRef("");
  // A folder view waits for its folder: undefined while loading, null when
  // it doesn't exist (deleted, or another account's).
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
  const searchController = useCardsSearchController({
    folderId: folder?._id,
    folderQuery: isSmartFolder ? (folder?.query ?? "") : undefined,
    initialUrlState: searchUrlState,
    onNavigateView,
    view,
  });
  const { applyUrlState, urlState } = searchController;

  // The URL and the search stay in step both ways. What this screen last
  // wrote (or read) is remembered so its own URL updates never echo back.
  const syncedUrlStateRef = useRef<SearchUrlState | null>(
    searchUrlState ?? null
  );
  // The URL state this screen last read. Effects re-run without the URL
  // changing (Activity showing a hidden screen again, Strict Mode), and the
  // URL can still lag this screen's own write then; only a real URL change
  // may overwrite the search.
  const readUrlStateRef = useRef<SearchUrlState | null>(searchUrlState ?? null);
  useEffect(() => {
    if (!searchUrlState) {
      return;
    }
    const lastRead = readUrlStateRef.current;
    readUrlStateRef.current = searchUrlState;
    if (
      (lastRead && isSameSearchUrlState(lastRead, searchUrlState)) ||
      (syncedUrlStateRef.current &&
        isSameSearchUrlState(syncedUrlStateRef.current, searchUrlState))
    ) {
      return;
    }
    const previous = syncedUrlStateRef.current;
    syncedUrlStateRef.current = searchUrlState;
    // When only the types or sort changed (a sidebar type), keep any text
    // still being typed rather than resetting it to the URL's older query.
    applyUrlState(searchUrlState, {
      keepSearch:
        previous !== null && previous.q.trim() === searchUrlState.q.trim(),
    });
  }, [applyUrlState, searchUrlState]);
  useEffect(() => {
    const previous = syncedUrlStateRef.current;
    if (previous && isSameSearchUrlState(previous, urlState)) {
      return;
    }
    syncedUrlStateRef.current = urlState;
    // A reshuffle is a new order too, unless the URL only lacked a seed.
    const sortChanged =
      previous !== null &&
      (previous.sort !== urlState.sort ||
        (previous.seed !== undefined && previous.seed !== urlState.seed));
    const typesChanged =
      previous !== null &&
      (previous.types.length !== urlState.types.length ||
        previous.types.some((type) => !urlState.types.includes(type)));
    const tagChanged =
      previous !== null && (previous.tag ?? "") !== (urlState.tag ?? "");
    if (sortChanged || typesChanged || tagChanged) {
      window.scrollTo({ top: 0 });
    }
    onSearchUrlStateChange?.(urlState, {
      sortChanged,
      tagChanged,
      typesChanged,
    });
  }, [onSearchUrlStateChange, urlState]);

  const queryArgs = searchController.queryArgs;
  const searchKey = useMemo(() => JSON.stringify(queryArgs), [queryArgs]);
  const reportedSearchKeyRef = useRef<string | null>(null);
  const {
    results: cards,
    status: cardsStatus,
    loadMore,
  } = usePaginatedQuery(
    api.cards.searchCardsPaginated,
    isFolderView && !folder ? "skip" : queryArgs,
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

  // Saving what is on screen as a smart folder, or editing the smart folder
  // being viewed.
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
  // Lowercased manual folder names, so a smart folder's `folder:` that no
  // longer names one reads "No folder named …".
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

  // Some filtered views (colors or favorites inside a folder) can return a
  // page with no match while more remain. Whenever a requested page adds no
  // cards, ask for the next one, so the grid neither shows an empty state
  // nor stalls with matches still further down.
  const isSeekingFirstMatch =
    cards.length === 0 &&
    (cardsStatus === "CanLoadMore" || cardsStatus === "LoadingMore");
  const countAtLoadMoreRef = useRef<number | null>(null);
  const requestMoreCards = useCallback(() => {
    countAtLoadMoreRef.current = cards.length;
    loadMore(SEARCH_DEFAULT_CARD_LIMIT);
  }, [cards.length, loadMore]);
  useEffect(() => {
    if (cardsStatus !== "CanLoadMore") {
      return;
    }
    if (cards.length === 0 || countAtLoadMoreRef.current === cards.length) {
      requestMoreCards();
    } else {
      countAtLoadMoreRef.current = null;
    }
  }, [cards.length, cardsStatus, requestMoreCards]);

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

  const selectedCard = useMemo(
    () =>
      displayCards.find((card: Doc<"cards">) => card._id === selectedCardId) ??
      null,
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

  // Sets the favorite to the opposite of what the card shows (instantly,
  // through the optimistic update), so pressing F quickly never races.
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
      // Optimistic: the next edit builds on this list even before the server
      // confirms it, and failures surface through onError as a toast.
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

  const AddCardFormWrapper = useCallback(
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

    // A debounced search that hasn't been sent yet is still loading, not empty.
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

    // A routed view (or the Archive filter) with nothing else narrowing it.
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

  const content = (
    <>
      <CardsSearchHeader
        {...searchBarProps}
        leading={headerLeading}
        onSaveSearch={
          saveableQuery === null
            ? undefined
            : () => setFolderDialog({ mode: "save", query: saveableQuery })
        }
        placeholder={
          folder
            ? `Search ${clipName(folder.name)}...`
            : SEARCH_PLACEHOLDERS[view ?? "all"]
        }
      />

      {folder && !isSmartFolder && (
        <div className="mb-4 flex min-w-0 items-center gap-2">
          <FolderDot className="size-3" color={folder.color} />
          <h1
            className="min-w-0 truncate font-semibold text-lg"
            dir="auto"
            title={folder.name}
          >
            {folder.name}
          </h1>
          <span className="shrink-0 text-muted-foreground text-sm tabular-nums">
            {folder.activeCardCount}{" "}
            {folder.activeCardCount === 1 ? "card" : "cards"}
          </span>
        </div>
      )}

      {folder && isSmartFolder && (
        <div className="mb-4 min-w-0 space-y-2">
          <div className="flex min-w-0 items-center gap-2">
            <FolderSearch
              aria-hidden="true"
              className={
                folder.color
                  ? `size-4 shrink-0 ${FOLDER_ICON_CLASSES[folder.color]}`
                  : "size-4 shrink-0 text-muted-foreground"
              }
            />
            <h1
              className="min-w-0 truncate font-semibold text-lg"
              dir="auto"
              title={folder.name}
            >
              {folder.name}
            </h1>
            <span className="sr-only">Smart folder</span>
            <Button
              className="ml-auto shrink-0 text-muted-foreground"
              onClick={editSmartFolder}
              size="sm"
              variant="ghost"
            >
              <Pencil />
              <span className="max-sm:sr-only">Edit search</span>
            </Button>
          </div>
          <SmartFolderQuery
            folderNames={folderNames}
            query={folder.query ?? ""}
          />
        </div>
      )}

      {displayCards.length > 0 ? (
        <MasonryGrid
          AddCardFormComponent={AddCardFormWrapper}
          addToFolder={
            addToFolder
              ? { id: addToFolder._id, name: addToFolder.name }
              : undefined
          }
          batchSize={SEARCH_DEFAULT_CARD_LIMIT}
          filteredCards={displayCards}
          folder={
            // No card is ever in a smart folder, so its view offers no
            // Remove from folder.
            folder && !isSmartFolder
              ? { id: folder._id, name: folder.name }
              : undefined
          }
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
            // Like the bulk bar: optimistic, with Undo in the toast.
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
          openCardId={selectedCardId}
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
      ) : (
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
        onTagClick={handleTagClick}
        open={!!selectedCardId}
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
