import { api } from "@teak/convex";
import { useConvexAuth } from "convex/react";
import { useCallback, useEffect } from "react";
import { useQuery } from "../../convexQueryHooks";
import { useBulkCardActions } from "../../hooks/useBulkCardActions";
import { useCardModal } from "../../hooks/useCardModal";
import { useLinkThumbnail } from "../../hooks/useLinkThumbnail";
import { useReprocessCard } from "../../hooks/useReprocessCard";
import { CardModal } from "./CardModal";
import { shouldReportInvalidHydratedCard } from "./cardHydrationState";
import type { CardModalCard } from "./types";

export interface ConnectedCardModalProps {
  card?: CardModalCard | null;
  cardId: string | null;
  onCancel?: () => void;
  onCardTypeClick?: (cardType: string) => void;
  onCardUpdate?: (card: CardModalCard) => void;
  onInvalidCard?: () => void;
  /** Lists the cards closest in meaning to a card. */
  onMoreLikeThis?: (cardId: string) => void;
  /** Shows the next card in the grid; absent on the last card. */
  onNext?: () => void;
  /** Shows the previous card in the grid; absent on the first card. */
  onPrevious?: () => void;
  onTagClick?: (tag: string) => void;
  open: boolean;
  returnFocus?: (cardId: string) => boolean;
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
  onMoreLikeThis,
  returnFocus,
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
    toggleDone,
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

  const linkThumbnail = useLinkThumbnail(card?._id);

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
      linkThumbnail={card?.type === "link" ? linkThumbnail : undefined}
      onCancel={onCancel}
      onCardTypeClick={onCardTypeClick}
      onMoreLikeThis={onMoreLikeThis}
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
      returnFocus={returnFocus}
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
      toggleDone={toggleDone}
      toggleFavorite={toggleFavorite}
      updateContent={updateContent}
      updateNotes={updateNotes}
      updateTitle={updateTitle}
    />
  );
}
