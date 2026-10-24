import { api } from "@teak/convex";
import { useConvexAuth } from "convex/react";
import { useCallback, useEffect } from "react";
import { useBulkCardActions } from "../../hooks/useBulkCardActions";
import { useCardHighlights } from "../../hooks/useCardHighlights";
import { useCardLinkEditor } from "../../hooks/useCardLinkEditor";
import { useCardModal } from "../../hooks/useCardModal";
import { useLinkThumbnail } from "../../hooks/useLinkThumbnail";
import { useReprocessCard } from "../../hooks/useReprocessCard";
import { useSaveLinkedPdf } from "../../hooks/useSaveLinkedPdf";
import { useQuery } from "../../lib/convexQueryHooks";
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
  onMoreLikeThis?: (cardId: string) => void;
  onNext?: () => void;
  onOpenCard?: (cardId: string) => void;
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
  onOpenCard,
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
    acceptAiTag,
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

  const cardLinks = useCardLinkEditor({
    currentCardId: card?._id,
    onOpenCard,
    value: card?.type === "text" ? (getCurrentValue("content") ?? "") : "",
  });
  // Only a server-confirmed card: an optimistic one has no real id yet.
  const backlinks = useQuery(
    api.cards.getCardBacklinks,
    canHydrateCard && hydratedCard?._id ? { cardId: hydratedCard._id } : "skip"
  );

  // A link with an article, or with highlights an import brought: only a
  // server-confirmed card, as with backlinks.
  const highlights = useCardHighlights(
    hydratedCard?._id,
    canHydrateCard &&
      hydratedCard?.type === "link" &&
      (hydratedCard.hasHighlights === true ||
        hydratedCard.article?.status === "ready")
  );
  const linkThumbnail = useLinkThumbnail(card?._id);
  const { isSaving: isSavingPdf, save: savePdf } = useSaveLinkedPdf(onOpenCard);

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
      backlinks={backlinks}
      card={card}
      cardId={cardId}
      cardLinks={card?.type === "text" ? cardLinks : undefined}
      downloadFile={downloadFile}
      getCurrentValue={getCurrentValue}
      handleDelete={handleDelete}
      handlePermanentDelete={handlePermanentDelete}
      handleRestore={handleRestore}
      hasUnsavedChanges={hasUnsavedChanges}
      highlights={card?.type === "link" ? highlights : undefined}
      isDownloading={isDownloading}
      isReprocessing={Boolean(cardId && reprocessingCardId === cardId)}
      linkThumbnail={card?.type === "link" ? linkThumbnail : undefined}
      onCancel={onCancel}
      onCardTypeClick={onCardTypeClick}
      onMoreLikeThis={onMoreLikeThis}
      onNext={onNext}
      onOpenCard={onOpenCard}
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
      savePdf={
        card?.type === "link" && card.metadata?.linkCategory?.pdfUrl
          ? {
              isSaving: isSavingPdf(card._id),
              save: () => void savePdf(card._id),
            }
          : undefined
      }
      saveState={saveState}
      tags={{
        acceptAiTag,
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
