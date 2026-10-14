import { api } from "@teak/convex";
import { useConvexAuth } from "convex/react";
import { useCallback, useEffect } from "react";
import { useQuery } from "../../convexQueryHooks";
import { useBulkCardActions } from "../../hooks/useBulkCardActions";
import { useCardModal } from "../../hooks/useCardModal";
import { useReprocessCard } from "../../hooks/useReprocessCard";
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
  /** Shows the next card in the grid; absent on the last card. */
  onNext?: () => void;
  /** Shows the previous card in the grid; absent on the first card. */
  onPrevious?: () => void;
  onTagClick?: (tag: string) => void;
  open: boolean;
}

export function ConnectedCardModal({
  cardId,
  card: cardData,
  open,
  onCancel,
  onCardTypeClick,
  onCardUpdate,
  onInvalidCard,
  onNext,
  onPrevious,
  onTagClick,
}: ConnectedCardModalProps) {
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

  const {
    card,
    tagInput,
    setTagInput,
    updateContent,
    updateNotes,
    updateTitle,
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
    saveState,
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

  return (
    <CardModal
      card={card}
      cardId={cardId}
      downloadFile={downloadFile}
      getCurrentValue={getCurrentValue}
      handleDelete={handleDelete}
      handlePermanentDelete={handlePermanentDelete}
      handleRestore={handleRestore}
      hasUnsavedChanges={hasUnsavedChanges}
      isDownloading={isDownloading}
      isReprocessing={Boolean(cardId && reprocessingCardId === cardId)}
      onCancel={onCancel}
      onCardTypeClick={onCardTypeClick}
      onNext={onNext}
      onPrevious={onPrevious}
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
      saveState={saveState}
      tags={{
        addTag,
        removeAiTag,
        removeTag,
        setTagInput,
        tagInput,
      }}
      toggleArchive={toggleArchive}
      toggleFavorite={toggleFavorite}
      updateContent={updateContent}
      updateNotes={updateNotes}
      updateTitle={updateTitle}
    />
  );
}
