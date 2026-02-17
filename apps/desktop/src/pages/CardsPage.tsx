import { api } from "@teak/convex";
import type { CardModalCard } from "@teak/ui/card-modal";
import { CardModal } from "@teak/ui/card-modal";
import type { CardWithUrls } from "@teak/ui/cards";
import { Spinner } from "@teak/ui/components/ui/spinner";
import { EmptyState } from "@teak/ui/feedback/EmptyState";
import {
  MoreInformationModal,
  NotesEditModal,
  TagManagementModal,
} from "@teak/ui/modals";
import { useQuery } from "convex/react";
import { usePaginatedQuery } from "convex-helpers/react/cache/hooks";
import { useCallback, useState } from "react";
import { CardGrid } from "@/components/CardGrid";
import { useCardModal } from "@/hooks/useCardModal";

const CARDS_BATCH_SIZE = 24;

export function CardsPage() {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [showTagManagementModal, setShowTagManagementModal] = useState(false);
  const [showMoreInfoModal, setShowMoreInfoModal] = useState(false);
  const [showNotesEditModal, setShowNotesEditModal] = useState(false);

  const { results, status, loadMore } = usePaginatedQuery(
    api.cards.searchCardsPaginated,
    {},
    { initialNumItems: CARDS_BATCH_SIZE }
  );

  const selectedCard = useQuery(
    api.cards.getCard,
    selectedCardId ? { id: selectedCardId } : "skip"
  );

  const cardModalActions = useCardModal(selectedCardId, { card: selectedCard });

  const cards = results;
  const isLoadingFirstPage = status === "LoadingFirstPage";
  const isLoadingMore = status === "LoadingMore";
  const hasMore = status === "CanLoadMore";

  const handleCardClick = useCallback((card: CardWithUrls) => {
    setSelectedCardId(card._id);
  }, []);

  const handleAddTags = useCallback((cardId: string) => {
    setSelectedCardId(cardId);
    setShowTagManagementModal(true);
  }, []);

  const handleModalClose = useCallback(() => {
    setSelectedCardId(null);
    setShowTagManagementModal(false);
    setShowMoreInfoModal(false);
    setShowNotesEditModal(false);
  }, []);

  const cardWithUrls = selectedCard as CardModalCard | null;

  if (isLoadingFirstPage) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

  if (cards.length === 0) {
    return <EmptyState />;
  }

  return (
    <>
      <CardGrid
        cards={cards as CardWithUrls[]}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        onAddTags={handleAddTags}
        onCardClick={handleCardClick}
        onLoadMore={() => loadMore(CARDS_BATCH_SIZE)}
      />

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
    </>
  );
}
