import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { SEARCH_DEFAULT_CARD_LIMIT } from "@teak/convex/shared";
import type { CardModalCard } from "@teak/ui/card-modal";
import { CardModal } from "@teak/ui/card-modal";
import type { CardWithUrls } from "@teak/ui/cards";
import { Button } from "@teak/ui/components/ui/button";
import { DragOverlay } from "@teak/ui/feedback/DragOverlay";
import { PageLoadingState } from "@teak/ui/feedback/PageLoadingState";
import { AddCardEmptyState, AddCardForm } from "@teak/ui/forms";
import { MasonryGrid } from "@teak/ui/grids";
import {
  useCardActions,
  useCardClipboard,
  useCardModal,
  useCardModalFilterActions,
  useCardsSearchController,
} from "@teak/ui/hooks";
import {
  MoreInformationModal,
  NotesEditModal,
  TagManagementModal,
} from "@teak/ui/modals";
import { CardsSearchHeader } from "@teak/ui/search";
import { useQuery } from "convex/react";
import { usePaginatedQuery } from "convex-helpers/react/cache/hooks";
import { Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useGlobalDragDrop } from "@/hooks/useGlobalDragDrop";
import { buildWebUrl } from "@/lib/web-urls";

// Convex IDs are non-empty alphanumeric strings (with underscores).
// This rejects obviously malformed values like spaces, slashes, or empty strings.
const CONVEX_ID_PATTERN = /^[a-zA-Z0-9_]+$/;

function DesktopUpgradeLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      className={className}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        void openUrl(href);
      }}
    >
      {children}
    </a>
  );
}

export function CardsPage() {
  const navigate = useNavigate();
  const searchController = useCardsSearchController();
  const [searchParams, setSearchParams] = useSearchParams();
  const cardIdFromUrl = searchParams.get("card");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(
    cardIdFromUrl
  );
  const [showTagManagementModal, setShowTagManagementModal] = useState(false);
  const [showMoreInfoModal, setShowMoreInfoModal] = useState(false);
  const [showNotesEditModal, setShowNotesEditModal] = useState(false);

  const setCardQueryParam = useCallback(
    (cardId: string | null, replace = false) => {
      setSearchParams(
        (prev) => {
          const nextParams = new URLSearchParams(prev);
          const currentCardId = nextParams.get("card");

          if (cardId) {
            if (currentCardId === cardId) {
              return prev;
            }
            nextParams.set("card", cardId);
          } else {
            if (!currentCardId) {
              return prev;
            }
            nextParams.delete("card");
          }

          return nextParams;
        },
        { replace }
      );
    },
    [setSearchParams]
  );

  useEffect(() => {
    setSelectedCardId(cardIdFromUrl);
  }, [cardIdFromUrl]);

  const { results, status, loadMore } = usePaginatedQuery(
    api.cards.searchCardsPaginated,
    searchController.queryArgs,
    { initialNumItems: SEARCH_DEFAULT_CARD_LIMIT }
  );

  const {
    addFilter,
    addKeywordTag,
    clearAllFilters,
    displayCards,
    hasNoFilters,
    resetKey,
    searchBarProps,
    setRemoteCards,
    showTrashOnly,
  } = searchController;

  useEffect(() => {
    setRemoteCards(results);
  }, [results, setRemoteCards]);

  const isValidCardId = selectedCardId
    ? CONVEX_ID_PATTERN.test(selectedCardId)
    : false;

  const selectedCard = useQuery(
    api.cards.getCard,
    selectedCardId && isValidCardId
      ? { id: selectedCardId as Id<"cards"> }
      : "skip"
  );

  const cardModalActions = useCardModal(selectedCardId, { card: selectedCard });
  const cardActions = useCardActions({
    onDeleteSuccess: (message?: string) => message && toast.success(message),
    onRestoreSuccess: (message?: string) => message && toast.success(message),
    onPermanentDeleteSuccess: (message?: string) =>
      message && toast.success(message),
    onError: (_error: Error, operation: string) => {
      toast.error(`Failed to ${operation}`);
    },
  });
  const { handleCopyImage } = useCardClipboard();
  const { getRootProps, getInputProps, isDragActive } = useGlobalDragDrop();

  const isLoadingMore = status === "LoadingMore";
  const hasMore = status === "CanLoadMore";
  const upgradeUrl = buildWebUrl("/settings");

  const handleCardClick = useCallback(
    (card: CardWithUrls) => {
      setSelectedCardId(card._id);
      setCardQueryParam(card._id);
    },
    [setCardQueryParam]
  );

  const handleAddTags = useCallback(
    (cardId: string) => {
      setSelectedCardId(cardId);
      setCardQueryParam(cardId);
      setShowTagManagementModal(true);
    },
    [setCardQueryParam]
  );

  const handleModalClose = useCallback(() => {
    setSelectedCardId(null);
    setCardQueryParam(null, true);
    setShowTagManagementModal(false);
    setShowMoreInfoModal(false);
    setShowNotesEditModal(false);
  }, [setCardQueryParam]);

  useEffect(() => {
    if (selectedCardId && (!isValidCardId || selectedCard === null)) {
      handleModalClose();
    }
  }, [handleModalClose, isValidCardId, selectedCard, selectedCardId]);

  const { handleCardTypeClick, handleTagClick } = useCardModalFilterActions({
    addFilter,
    addKeywordTag,
    onCloseModal: handleModalClose,
  });

  const cardWithUrls = selectedCard as CardModalCard | null;

  const settingsButton = (
    <Button
      onClick={() => navigate("/settings")}
      size="icon"
      type="button"
      variant="outline"
    >
      <Settings className="size-4" />
    </Button>
  );

  const renderEmptyState = () => {
    if (status === "LoadingFirstPage") {
      return <PageLoadingState fullScreen={false} />;
    }

    if (displayCards.length === 0 && hasNoFilters) {
      return (
        <AddCardEmptyState
          UpgradeLinkComponent={DesktopUpgradeLink}
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

  return (
    <div {...getRootProps()} className="relative">
      <input {...getInputProps()} />
      <main className="mx-auto max-w-7xl px-4 pb-10">
        <CardsSearchHeader {...searchBarProps} SettingsButton={settingsButton} />

        {displayCards.length > 0 ? (
          <MasonryGrid
            AddCardFormComponent={() => (
              <AddCardForm
                UpgradeLinkComponent={DesktopUpgradeLink}
                upgradeUrl={upgradeUrl}
              />
            )}
            filteredCards={displayCards}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onAddTags={handleAddTags}
            onBulkDeleteCards={async (cardIds) => {
              const result = await cardActions.handleBulkDeleteCards(
                cardIds as Id<"cards">[]
              );
              return {
                ...result,
                failedIds: result.failedIds as string[],
              };
            }}
            onCardClick={handleCardClick}
            onCopyImage={handleCopyImage}
            onDeleteCard={async (cardId) =>
              cardActions.handleDeleteCard(cardId as Id<"cards">)
            }
            onLoadMore={() => loadMore(SEARCH_DEFAULT_CARD_LIMIT)}
            onPermanentDeleteCard={(cardId) =>
              cardActions.handlePermanentDeleteCard(cardId as Id<"cards">)
            }
            onRestoreCard={(cardId) =>
              cardActions.handleRestoreCard(cardId as Id<"cards">)
            }
            onToggleFavorite={(cardId) =>
              cardActions.handleToggleFavorite(cardId as Id<"cards">)
            }
            resetKey={resetKey}
            showAddForm={!showTrashOnly}
            showBulkActions={true}
            showTrashOnly={showTrashOnly}
          />
        ) : (
          renderEmptyState()
        )}

        <CardModal
          card={cardWithUrls}
          downloadFile={cardModalActions.downloadFile}
          getCurrentValue={cardModalActions.getCurrentValue}
          handleDelete={cardModalActions.handleDelete}
          handlePermanentDelete={cardModalActions.handlePermanentDelete}
          handleRestore={cardModalActions.handleRestore}
          hasUnsavedChanges={cardModalActions.hasUnsavedChanges}
          MoreInformationModal={
            <MoreInformationModal
              card={cardWithUrls}
              onOpenChange={setShowMoreInfoModal}
              open={showMoreInfoModal}
            />
          }
          NotesEditModal={
            <NotesEditModal
              notes={cardModalActions.getCurrentValue("notes") || ""}
              onCancel={() => {}}
              onOpenChange={setShowNotesEditModal}
              onSave={cardModalActions.saveNotes}
              open={showNotesEditModal}
            />
          }
          onCancel={handleModalClose}
          onCardTypeClick={handleCardTypeClick}
          onTagClick={handleTagClick}
          open={!!selectedCardId}
          openLink={cardModalActions.openLink}
          saveChanges={cardModalActions.saveChanges}
          setShowMoreInfoModal={setShowMoreInfoModal}
          setShowNotesEditModal={setShowNotesEditModal}
          setShowTagManagementModal={setShowTagManagementModal}
          showMoreInfoModal={showMoreInfoModal}
          showNotesEditModal={showNotesEditModal}
          showTagManagementModal={showTagManagementModal}
          TagManagementModal={
            <TagManagementModal
              aiTags={cardWithUrls?.aiTags || []}
              onAddTag={cardModalActions.addTag}
              onOpenChange={setShowTagManagementModal}
              onRemoveAiTag={cardModalActions.removeAiTag}
              onRemoveTag={cardModalActions.removeTag}
              open={showTagManagementModal}
              setTagInput={cardModalActions.setTagInput}
              tagInput={cardModalActions.tagInput}
              userTags={cardWithUrls?.tags || []}
            />
          }
          toggleFavorite={cardModalActions.toggleFavorite}
          updateContent={cardModalActions.updateContent}
        />
      </main>
      <DragOverlay isDragActive={isDragActive} />
    </div>
  );
}
