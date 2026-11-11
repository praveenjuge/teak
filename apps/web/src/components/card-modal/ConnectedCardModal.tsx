import { api } from "@teak/convex";
import { useConvexAuth } from "convex/react";
import { useCallback, useEffect } from "react";
import { useCopyCard } from "@/hooks/useCardClipboard";
import { useCardHighlights } from "@/hooks/useCardHighlights";
import type { ClientCard } from "@/lib/cardTypes";
import {
  type RunnableCardActionId,
  useCardActions,
} from "../../hooks/useCardActions";
import { useCardLinkEditor } from "../../hooks/useCardLinkEditor";
import { useCardModal } from "../../hooks/useCardModal";
import { useCardTagEditor } from "../../hooks/useCardTagEditor";
import { useLinkThumbnail } from "../../hooks/useLinkThumbnail";
import { usePaletteColors } from "../../hooks/usePaletteColors";
import { useReprocessCard } from "../../hooks/useReprocessCard";
import { useSaveLinkedPdf } from "../../hooks/useSaveLinkedPdf";
import { useQuery } from "../../lib/convexQueryHooks";
import { CardModal } from "./CardModal";
import { shouldReportInvalidHydratedCard } from "./cardHydrationState";

export interface ConnectedCardModalProps {
  card?: ClientCard | null;
  cardId: string | null;
  onCancel?: () => void;
  onCardTypeClick?: (cardType: string) => void;
  onInvalidCard?: () => void;
  onMoreLikeThis?: (cardId: string) => void;
  onOpenCard?: (cardId: string) => void;
  onStep?: (direction: 1 | -1) => void;
  onTagClick?: (tag: string) => void;
  open: boolean;
  openOrigin?: { x: number; y: number };
  returnFocus?: (cardId: string) => boolean;
  steps?: { next: boolean; previous: boolean };
}

export function ConnectedCardModal({
  cardId,
  card: cardData,
  open,
  onCancel,
  onCardTypeClick,
  onInvalidCard,
  onOpenCard,
  onStep,
  onTagClick,
  onMoreLikeThis,
  openOrigin,
  returnFocus,
  steps,
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
    updateContent,
    updateNotes,
    updateTitle,
    openLink,
    downloadFile,
    saveChanges,
    saveState,
    hasUnsavedChanges,
    getCurrentValue,
    isDownloading,
  } = useCardModal(cardId, { card: resolvedCard });
  const tagEditor = useCardTagEditor(card);

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
  const paletteColors = usePaletteColors(card?._id);
  const { isSaving: isSavingPdf, save: savePdf } = useSaveLinkedPdf(onOpenCard);

  const { copyImage: copyCardImage } = useCopyCard();
  const actions = useCardActions();
  const runAction = useCallback(
    (action: RunnableCardActionId) =>
      card ? actions.run(action, card, "dialog") : Promise.resolve(false),
    [actions, card]
  );

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
      copyImage={card ? () => copyCardImage(card) : undefined}
      downloadFile={downloadFile}
      getCurrentValue={getCurrentValue}
      hasUnsavedChanges={hasUnsavedChanges}
      highlights={card?.type === "link" ? highlights : undefined}
      isDownloading={isDownloading}
      isReprocessing={Boolean(cardId && reprocessingCardId === cardId)}
      linkThumbnail={card?.type === "link" ? linkThumbnail : undefined}
      onCancel={onCancel}
      onCardTypeClick={onCardTypeClick}
      onMoreLikeThis={onMoreLikeThis}
      onOpenCard={onOpenCard}
      onReprocess={
        cardId
          ? () => {
              void reprocess(cardId);
            }
          : undefined
      }
      onStep={onStep}
      onTagClick={onTagClick}
      open={open}
      openLink={openLink}
      openOrigin={openOrigin}
      paletteColors={card?.type === "palette" ? paletteColors : undefined}
      returnFocus={returnFocus}
      runAction={runAction}
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
      steps={steps}
      tags={tagEditor}
      updateContent={updateContent}
      updateNotes={updateNotes}
      updateTitle={updateTitle}
    />
  );
}
