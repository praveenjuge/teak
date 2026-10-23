"use client";

import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import {
  parseSearchQuery,
  SEARCH_DEFAULT_CARD_LIMIT,
} from "@teak/convex/shared";
import { captureEvent } from "@teak/convex/shared/analytics";
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
import type { CardWithUrls } from "@/components/cards";
import { CardsGridSkeleton } from "@/components/feedback/CardSkeleton";
import { VaultSetupState } from "@/components/feedback/VaultSetupState";
import type { AddCardFormProps } from "@/components/forms";
import { AddCardEmptyState, AddCardForm } from "@/components/forms";
import { MasonryGrid, type MasonryGridHandle } from "@/components/grids";
import { CardsSearchHeader } from "@/components/search";
import { Button } from "@/components/ui/button";
import {
  useBulkCardActions,
  useCardActions,
  useCardClipboard,
  useCardModalFilterActions,
  useCardsSearchController,
  useVaultSetup,
} from "@/hooks";
import type { CardsVisualFilters } from "@/lib/cardsSearchState";
import { clipFolderName } from "@/lib/clipFolderName";
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
import { ConnectedRevisitDeck } from "../components/revisit/ConnectedRevisitDeck";
import { focusRevisitDeck } from "../components/revisit/RevisitDeck";
import type { CloseCardOptions } from "../hooks/useCardQueryParamState";
import { useFolders } from "../hooks/useFolders";
import { useLoadUntilMatches } from "../hooks/useLoadUntilMatches";
import { useRelevanceRanking } from "../hooks/useRelevanceRanking";
import { useRevisitMode } from "../hooks/useRevisitMode";
import { useSemanticSearch } from "../hooks/useSemanticSearch";
import { useStableHandlers } from "../hooks/useStableHandlers";
import { useViewHasHiddenCards } from "../hooks/useViewHasHiddenCards";
import { getAdjacentCardIdsKeepingPlace } from "../lib/cardNeighbors";
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
import { tagsAfterAdding, tagsAfterRemoving } from "../lib/tagManagement";
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

export type { SearchUrlChange } from "../lib/searchUrlSync";

interface CardsScreenProps {
  addToFolderId?: string;
  contentContainerClassName?: string;
  focusComposer?: boolean;
  folderId?: string;
  headerLeading?: ReactNode;
  initialVisualFilters?: CardsVisualFilters;
  onAddCardsToFolder?: (folderId: string) => void;
  onAddToFolderDone?: (folderId: string, added: boolean) => void;
  onCloseCard: (options?: CloseCardOptions) => void;
  onFocusComposerHandled?: () => void;
  onNavigateView?: (view: LibraryView) => void;
  onOpenCard: (cardId: string) => void;
  onOpenFolder?: (folderId: string) => void;
  onSearchUrlStateChange?: (
    state: SearchUrlState,
    change: SearchUrlChange
  ) => void;
  onSwitchCard?: (cardId: string) => void;
  onUpgrade?: AddCardFormProps["onUpgrade"];
  onVisualFiltersChange?: (filters: CardsVisualFilters) => void;
  queryRetryKey?: string;
  searchUrlState?: SearchUrlState;
  selectedCardId: string | null;
  toastIdPrefix?: string;
  UpgradeLinkComponent?: AddCardFormProps["UpgradeLinkComponent"];
  upgradeUrl: string;
  view?: LibraryView;
}

export function CardsScreen({
  addToFolderId,
  focusComposer = false,
  folderId,
  initialVisualFilters,
  onAddCardsToFolder,
  onAddToFolderDone,
  selectedCardId,
  onOpenCard,
  onCloseCard,
  onFocusComposerHandled,
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
  const [composerFocus, setComposerFocus] = useState(() => ({
    pending: focusComposer,
    requested: focusComposer,
  }));
  if (focusComposer !== composerFocus.requested) {
    setComposerFocus({
      pending: focusComposer || composerFocus.pending,
      requested: focusComposer,
    });
  }
  useEffect(() => {
    if (focusComposer) {
      onFocusComposerHandled?.();
    }
  }, [focusComposer, onFocusComposerHandled]);
  const handleComposerFocus = useCallback(() => {
    setComposerFocus((current) =>
      current.pending ? { ...current, pending: false } : current
    );
  }, []);
  const gridRef = useRef<MasonryGridHandle | null>(null);
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
    if (
      change.sortChanged ||
      change.typesChanged ||
      change.tagChanged ||
      change.filtersChanged
    ) {
      window.scrollTo({ top: 0 });
    }
    onSearchUrlStateChange?.(urlState, change);
  }, [onSearchUrlStateChange, urlState, urlSync]);

  const queryArgs = searchController.queryArgs;
  const searchKey = useMemo(() => JSON.stringify(queryArgs), [queryArgs]);
  const reportedSearchKeyRef = useRef<string | null>(null);
  const relevance = useRelevanceRanking({
    ...queryArgs,
    enabled: !(isFolderView && !folder),
  });
  const {
    results: cards,
    status: cardsStatus,
    loadMore,
  } = usePaginatedQuery(
    api.cards.searchCardsPaginated,
    (isFolderView && !folder) || relevance.holding
      ? "skip"
      : {
          ...queryArgs,
          ...(relevance.useRelevanceScores ? { useRelevanceScores: true } : {}),
          ...(queryRetryKey ? { retryKey: queryRetryKey } : {}),
        },
    { initialNumItems: SEARCH_DEFAULT_CARD_LIMIT }
  );
  const semanticSearch = useSemanticSearch({
    ...queryArgs,
    enabled: !(isFolderView && !folder),
  });
  const similarity = useMemo(
    () => parseSearchQuery(queryArgs.searchQuery ?? "").similarity ?? null,
    [queryArgs.searchQuery]
  );
  const anchorCardId =
    similarity?.kind === "like" ? similarity.cardId : undefined;
  const listsTodo = useMemo(
    () =>
      parseSearchQuery(queryArgs.searchQuery ?? "").todo ||
      (isSmartFolder && parseSearchQuery(folder?.query ?? "").todo),
    [queryArgs.searchQuery, isSmartFolder, folder?.query]
  );
  const similarAnchor = useQuery(
    api.cards.similarAnchorSummary,
    anchorCardId ? { cardId: anchorCardId } : "skip"
  );
  let similarAnchorTitle: string | undefined;
  if (anchorCardId) {
    similarAnchorTitle =
      similarAnchor?.status === "unavailable"
        ? "unavailable card"
        : (similarAnchor?.title ?? "…");
  }

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
  const viewHasHiddenCards = useViewHasHiddenCards({
    asks:
      displayCards.length === 0 &&
      hasNoSearchFilters &&
      cardsStatus !== "LoadingFirstPage" &&
      !(isFolderView && (folder === undefined || isSmartFolder)),
    folderId: folder?._id,
    view: (view ?? "all") === "all" && showArchivedOnly ? "archive" : view,
  });
  const hiddenCardsHint = viewHasHiddenCards ? (
    <p className="text-muted-foreground text-xs">
      Some cards are hidden. Search #secret or #hidden to see them.
    </p>
  ) : null;
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

  const [fedResults, setFedResults] = useState<{
    cards: typeof cards;
    key: string;
  } | null>(null);
  if (fedResults?.cards !== cards || fedResults.key !== searchKey) {
    setFedResults({ cards, key: searchKey });
    setRemoteCards(cards, searchKey);
  }

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
      (cards.length === 0 && semanticSearch.isPending) ||
      reportedSearchKeyRef.current === searchKey
    ) {
      return;
    }
    reportedSearchKeyRef.current = searchKey;
    const qualifiers = Array.from(
      new Set(
        parseSearchQuery(queryArgs.searchQuery ?? "").qualifiers.map(
          (qualifier) => qualifier.key
        )
      )
    );
    captureEvent("search_performed", {
      ...(qualifiers.length > 0 ? { qualifiers } : {}),
      zero_result: cards.length === 0,
    });
  }, [
    cards.length,
    cardsStatus,
    isSeekingFirstMatch,
    queryArgs.searchQuery,
    searchController.hasActiveSearch,
    searchKey,
    semanticSearch.isPending,
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

  const neighborIds = useMemo(
    () =>
      displayCards
        .map((card: Doc<"cards">) => card._id as string)
        .filter((id: string) => !isOptimisticCard(id)),
    [displayCards]
  );
  // The last list that held the open card, so the arrows still step from
  // its place after an edit takes it out of the view.
  const [placeIds, setPlaceIds] = useState<readonly string[]>();
  if (
    selectedCardId &&
    placeIds !== neighborIds &&
    neighborIds.includes(selectedCardId)
  ) {
    setPlaceIds(neighborIds);
  }
  const { previous: previousCardId, next: nextCardId } = useMemo(
    () => getAdjacentCardIdsKeepingPlace(neighborIds, placeIds, selectedCardId),
    [neighborIds, placeIds, selectedCardId]
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

  const revisit = useRevisitMode({
    archiveOrTrash: showArchivedOnly || showTrashOnly,
    cardOpen: selectedCardId !== null,
    empty: displayCards.length === 0 && cardsStatus !== "LoadingFirstPage",
    librarySort: searchController.librarySort,
    replaceNextSortChange: urlSync.replaceNextSortChange,
    reshuffle: searchController.reshuffle,
    runBulkAction,
    setSort: searchController.setSort,
    urlDriven,
  });

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

  // Adding or removing a tag can take the card out of this list (a hidden
  // tag, a tag filter); read it by id so the dialog never edits a stale list.
  const liveTagManagementCard: Doc<"cards"> | null | undefined = useQuery(
    api.cards.getCard,
    tagManagementCardId ? { id: tagManagementCardId as Id<"cards"> } : "skip"
  );
  const tagManagementCard = useMemo(
    () =>
      (liveTagManagementCard?._id === tagManagementCardId
        ? liveTagManagementCard
        : null) ??
      displayCards.find(
        (card: Doc<"cards">) => card._id === tagManagementCardId
      ) ??
      null,
    [displayCards, liveTagManagementCard, tagManagementCardId]
  );

  const handleAddTags = useCallback((cardId: string) => {
    setTagManagementCardId(cardId);
  }, []);

  const { handleCopyImage } = useCardClipboard();

  // Both write the whole list, so neither writes for a card this screen
  // can't see yet (see tagsAfterAdding).
  const handleAddTag = useCallback(() => {
    const tags = tagsAfterAdding(tagManagementCard, tagInput);
    if (tags && tagManagementCardId) {
      void cardActions.updateField(
        tagManagementCardId as Id<"cards">,
        "tags",
        tags
      );
      setTagInput("");
    }
  }, [cardActions, tagInput, tagManagementCard, tagManagementCardId]);

  const handleRemoveTag = useCallback(
    (tagToRemove: string) => {
      const next = tagsAfterRemoving(tagManagementCard, tagToRemove);
      if (next && tagManagementCardId) {
        void cardActions.updateField(
          tagManagementCardId as Id<"cards">,
          "tags",
          next.tags
        );
      }
    },
    [cardActions, tagManagementCard, tagManagementCardId]
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

  // These close the card and change the search, so they replace the card's
  // URL: going Back would land after the search's own URL write.
  const closeCardForSearch = useCallback(
    () => onCloseCard({ replace: true }),
    [onCloseCard]
  );
  const { handleCardTypeClick, handleTagClick } = useCardModalFilterActions({
    addFilter,
    addKeywordTag,
    onCloseModal: closeCardForSearch,
  });

  const handleMoreLikeThis = useCallback(
    (cardId: string) => {
      onCloseCard({ replace: true });
      applyUrlState({ ...urlState, q: `like:${cardId}`, tag: "", types: [] });
      captureEvent("similar_search_opened", { source: "panel" });
    },
    [applyUrlState, onCloseCard, urlState]
  );

  const handleInvalidSelectedCard = useCallback(() => {
    onCloseCard();
    toast.error("Card not found");
  }, [onCloseCard]);

  const composerHandlers = useStableHandlers({ onOpenCard });
  const gridHandlers = useStableHandlers({
    onAddTags: handleAddTags,
    onAddToFolderDone: (added: boolean) => {
      if (addToFolder) {
        onAddToFolderDone?.(addToFolder._id, added);
      }
    },
    onBulkAction: runBulkAction,
    onCardClick: handleCardClick,
    onCopyImage: handleCopyImage,
    onDeleteCard: async (cardId: string) => {
      const { failedIds } = await runBulkAction("delete", [cardId]);
      return failedIds.length === 0;
    },
    onLoadMore: requestMoreCards,
    onPermanentDeleteCard: (cardId: string) =>
      cardActions.handlePermanentDeleteCard(cardId as Id<"cards">),
    onRestoreCard: (cardId: string) =>
      cardActions.handleRestoreCard(cardId as Id<"cards">),
    onToggleArchive: handleToggleArchive,
    onToggleFavorite: handleToggleFavorite,
  });

  const addCardForm = useMemo(
    () => (
      <AddCardForm
        autoFocus={composerFocus.pending}
        draftContentRef={draftContentRef}
        onFocus={handleComposerFocus}
        onOpenCard={composerHandlers.onOpenCard}
        onUpgrade={onUpgrade}
        UpgradeLinkComponent={UpgradeLinkComponent}
        upgradeUrl={upgradeUrl}
      />
    ),
    [
      UpgradeLinkComponent,
      composerFocus.pending,
      composerHandlers,
      handleComposerFocus,
      onUpgrade,
      upgradeUrl,
    ]
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
          {onNavigateView ? (
            <Button onClick={() => onNavigateView("all")} variant="outline">
              Go to Everything
            </Button>
          ) : null}
        </div>
      );
    }

    if (
      (isFolderView && folder === undefined) ||
      cardsStatus === "LoadingFirstPage" ||
      isSeekingFirstMatch ||
      searchController.isSearchPending ||
      (displayCards.length === 0 && semanticSearch.isPending)
    ) {
      return <CardsGridSkeleton />;
    }

    if (isSmartFolder && displayCards.length === 0 && hasNoSearchFilters) {
      return (
        <div className="flex flex-col items-center gap-3 py-24 text-center text-muted-foreground">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted">
            <FolderSearch aria-hidden="true" className="size-4" />
          </span>
          <p>
            {listsTodo
              ? "Nothing left to do."
              : "No cards match this smart folder."}
          </p>
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
          {hiddenCardsHint}
          {onAddCardsToFolder ? (
            <Button
              onClick={() => onAddCardsToFolder(folder._id)}
              variant="outline"
            >
              <Plus />
              Add cards
            </Button>
          ) : null}
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
          {hiddenCardsHint}
        </div>
      );
    }

    if (displayCards.length === 0 && hasNoFilters) {
      if (vaultSetup === "loading") {
        return <CardsGridSkeleton />;
      }
      return (
        <>
          <AddCardEmptyState
            onFocus={handleComposerFocus}
            UpgradeLinkComponent={UpgradeLinkComponent}
            upgradeUrl={upgradeUrl}
          />
          {hiddenCardsHint ? (
            <div className="mt-4 text-center">{hiddenCardsHint}</div>
          ) : null}
        </>
      );
    }

    if (displayCards.length === 0 && similarity) {
      const outcome = semanticSearch.outcome;
      let message =
        similarity.kind === "like"
          ? "Nothing similar yet"
          : "No images match this mood yet";
      let canRetry = false;
      if (outcome === "pending" || similarAnchor?.status === "pending") {
        message = "Still learning about this card. Try again in a moment.";
        canRetry = true;
      } else if (outcome === "rate_limited") {
        message = "Too many searches. Try again in a minute.";
      } else if (outcome === "unavailable") {
        message = "Couldn't search by meaning right now.";
        canRetry = true;
      }
      return (
        <div className="space-y-3 py-12 text-center">
          <p className="text-muted-foreground">{message}</p>
          {canRetry && (
            <Button onClick={semanticSearch.retry} variant="ghost">
              Try again
            </Button>
          )}
        </div>
      );
    }

    if (displayCards.length === 0) {
      return (
        <div className="space-y-4 py-12 text-center">
          <p className="text-muted-foreground">
            {listsTodo
              ? "Nothing left to do."
              : "Nothing found matching your filters"}
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
        onSortChange={revisit.onSortChange}
        placeholder={
          folder
            ? `Search ${clipFolderName(folder.name)}`
            : LIBRARY_VIEW_SEARCH_PLACEHOLDERS[view ?? "all"]
        }
        revisit={revisit.offer}
        similarAnchorTitle={similarAnchorTitle}
        title={title}
      />

      {showVaultSetup ? <VaultSetupState /> : null}

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
          {...gridHandlers}
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

      {revisit.revisiting ? (
        <ConnectedRevisitDeck
          onArchive={revisit.onArchive}
          onExit={revisit.exit}
          onOpenCard={onOpenCard}
          onStartOver={revisit.startOver}
          onUnarchive={revisit.onUnarchive}
          queryArgs={isFolderView && !folder ? null : queryArgs}
        />
      ) : null}

      <ConnectedCardModal
        card={selectedCard}
        cardId={selectedCardId}
        onCancel={onCloseCard}
        onCardTypeClick={handleCardTypeClick}
        onCardUpdate={updateCachedCard}
        onInvalidCard={handleInvalidSelectedCard}
        onMoreLikeThis={handleMoreLikeThis}
        onNext={
          onSwitchCard && nextCardId
            ? () => onSwitchCard(nextCardId)
            : undefined
        }
        onOpenCard={onSwitchCard ?? onOpenCard}
        onPrevious={
          onSwitchCard && previousCardId
            ? () => onSwitchCard(previousCardId)
            : undefined
        }
        onTagClick={handleTagClick}
        open={!!selectedCardId}
        returnFocus={revisit.revisiting ? focusRevisitDeck : returnFocusToGrid}
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
          toast.success(`Saved “${clipFolderName(saved.name)}”`, {
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
