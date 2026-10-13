import { api } from "@teak/convex";
import { useConvexAuth } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { useQuery } from "../../convexQueryHooks";
import { useBulkCardActions } from "../../hooks/useBulkCardActions";
import { useCardModal } from "../../hooks/useCardModal";
import { useReprocessCard } from "../../hooks/useReprocessCard";
import { MoreInformationModal } from "../modals/MoreInformationModal";
import { NotesEditModal } from "../modals/NotesEditModal";
import { TagManagementModal } from "../modals/TagManagementModal";
import { CardModal } from "./CardModal";
import { shouldReportInvalidHydratedCard } from "./cardHydrationState";
import type { CardModalCard } from "./types";

interface ConnectedCardModalProps {
  card?: CardModalCard | null;
  cardId: string | null;
  onCancel?: () => void;
  onCardTypeClick?: (cardType: string) => void;
  onCardUpdate?: (card: CardModalCard) => void;
  onInvalidCard?: () => void;
  onTagClick?: (tag: string) => void;
  onTagManagementOpenChange?: (open: boolean) => void;
  open: boolean;
  openTagManagement?: boolean;
}

export function ConnectedCardModal({
  cardId,
  card: cardData,
  open,
  onCancel,
  onCardTypeClick,
  onCardUpdate,
  onInvalidCard,
  onTagManagementOpenChange,
  onTagClick,
  openTagManagement = false,
}: ConnectedCardModalProps) {
  const [showTagManagementModal, setShowTagManagementModal] = useState(false);
  const [showMoreInfoModal, setShowMoreInfoModal] = useState(false);
  const [showNotesEditModal, setShowNotesEditModal] = useState(false);
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const canHydrateCard = Boolean(
    cardId && open && !isAuthLoading && isAuthenticated
  );

  const hydratedCard = useQuery(
    api.cards.getCardByUrlId,
    canHydrateCard ? { id: cardId as string } : "skip"
  );

  const resolvedCard = hydratedCard ?? cardData ?? null;
  const { pendingCardId: reprocessingCardId, reprocess } = useReprocessCard();

  const setTagManagementModalOpen = useCallback(
    (nextOpen: boolean) => {
      setShowTagManagementModal(nextOpen);
      onTagManagementOpenChange?.(nextOpen);
    },
    [onTagManagementOpenChange]
  );

  const {
    card,
    tagInput,
    setTagInput,
    updateContent,
    toggleFavorite,
    addTag,
    removeTag,
    removeAiTag,
    handleDelete,
    handleRestore,
    handlePermanentDelete,
    openLink,
    downloadFile,
    saveChanges,
    saveNotes,
    hasUnsavedChanges,
    getCurrentValue,
    isDownloading,
  } = useCardModal(cardId, {
    card: resolvedCard,
    onCardTypeClick,
    onCardUpdate,
  });

  // Archive leaves the current view, so it runs like a one-card bulk action:
  // the same toast, with Undo.
  const runBulkAction = useBulkCardActions("card-modal");
  const toggleArchive = useCallback(() => {
    if (!card) {
      return;
    }
    runBulkAction(card.isArchived ? "unarchive" : "archive", [card._id]).catch(
      () => undefined
    );
  }, [card, runBulkAction]);

  useEffect(() => {
    if (
      shouldReportInvalidHydratedCard({
        cardId,
        hasCardData: Boolean(cardData),
        hydratedCard,
        isAuthenticated,
        isAuthLoading,
        open,
      })
    ) {
      onInvalidCard?.();
    }
  }, [
    cardData,
    cardId,
    hydratedCard,
    isAuthenticated,
    isAuthLoading,
    onInvalidCard,
    open,
  ]);

  useEffect(() => {
    if (open && openTagManagement) {
      setTagManagementModalOpen(true);
    }
  }, [open, openTagManagement, setTagManagementModalOpen]);

  return (
    <CardModal
      card={card}
      downloadFile={downloadFile}
      getCurrentValue={getCurrentValue}
      handleDelete={handleDelete}
      handlePermanentDelete={handlePermanentDelete}
      handleRestore={handleRestore}
      hasUnsavedChanges={hasUnsavedChanges}
      isDownloading={isDownloading}
      isReprocessing={Boolean(cardId && reprocessingCardId === cardId)}
      MoreInformationModal={
        <MoreInformationModal
          card={card ?? null}
          onOpenChange={setShowMoreInfoModal}
          open={showMoreInfoModal}
        />
      }
      NotesEditModal={
        <NotesEditModal
          notes={getCurrentValue("notes") || ""}
          onCancel={() => {
            // noop
          }}
          onOpenChange={setShowNotesEditModal}
          onSave={saveNotes}
          open={showNotesEditModal}
        />
      }
      onCancel={onCancel}
      onCardTypeClick={onCardTypeClick}
      onReprocess={
        cardId
          ? () => {
              void reprocess(cardId);
            }
          : undefined
      }
      onTagClick={onTagClick}
      open={open}
      openLink={openLink}
      saveChanges={saveChanges}
      setShowMoreInfoModal={setShowMoreInfoModal}
      setShowNotesEditModal={setShowNotesEditModal}
      setShowTagManagementModal={setTagManagementModalOpen}
      showMoreInfoModal={showMoreInfoModal}
      showNotesEditModal={showNotesEditModal}
      showTagManagementModal={showTagManagementModal}
      TagManagementModal={
        <TagManagementModal
          aiTags={card?.aiTags || []}
          onAddTag={addTag}
          onOpenChange={setTagManagementModalOpen}
          onRemoveAiTag={removeAiTag}
          onRemoveTag={removeTag}
          open={showTagManagementModal}
          setTagInput={setTagInput}
          tagInput={tagInput}
          userTags={card?.tags || []}
        />
      }
      toggleArchive={toggleArchive}
      toggleFavorite={toggleFavorite}
      updateContent={updateContent}
    />
  );
}
