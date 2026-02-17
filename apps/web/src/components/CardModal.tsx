import { CARD_TYPE_LABELS, type CardType } from "@teak/convex/shared/constants";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@teak/ui/components/ui/dialog";
import { useState } from "react";
import { useCardModal } from "@/hooks/useCardModal";
import { metrics } from "@/lib/metrics";
import { CardMetadataPanel } from "./card-modal/CardMetadataPanel";
import { CardModalOverlays } from "./card-modal/CardModalOverlays";
import { CardModalPreview } from "./card-modal/CardModalPreview";
import type { CardModalCard } from "./card-modal/types";
import { Loading } from "./Loading";

interface CardModalProps {
  card?: CardModalCard | null;
  cardId: string | null;
  onCancel?: () => void;
  onCardTypeClick?: (cardType: string) => void;
  onTagClick?: (tag: string) => void;
  open: boolean;
}

export function CardModal({
  cardId,
  card: cardData,
  open,
  onCancel,
  onCardTypeClick,
  onTagClick,
}: CardModalProps) {
  const [showTagManagementModal, setShowTagManagementModal] = useState(false);
  const [showMoreInfoModal, setShowMoreInfoModal] = useState(false);
  const [showNotesEditModal, setShowNotesEditModal] = useState(false);

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
    handleCardTypeClick,
    saveChanges,
    saveNotes,
    hasUnsavedChanges,
    getCurrentValue,
    isSaved,
  } = useCardModal(cardId, { card: cardData, onCardTypeClick });

  const handleClose = async () => {
    if (hasUnsavedChanges) {
      await saveChanges();
    }
    setShowTagManagementModal(false);
    setShowMoreInfoModal(false);
    setShowNotesEditModal(false);
    onCancel?.();
  };

  const canDownload = Boolean(
    card?.fileId && ["document", "audio", "video", "image"].includes(card.type)
  );

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          void handleClose();
        }
      }}
      open={open}
    >
      <DialogContent className="flex h-[calc(90vh-80px)] max-h-[calc(90vh-80px)] flex-col gap-4 overflow-hidden border-0 p-0 shadow-none outline-0 focus-within:outline-0 md:max-w-7xl md:flex-row dark:border">
        {card ? (
          <>
            <DialogTitle className="sr-only">
              {CARD_TYPE_LABELS[card.type as CardType] || "Card"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              View and edit card details
            </DialogDescription>

            <div className="flex flex-1 flex-col gap-0 overflow-hidden md:flex-row">
              <CardModalPreview
                card={card}
                getCurrentValue={getCurrentValue}
                hasUnsavedChanges={hasUnsavedChanges}
                isSaved={isSaved}
                saveChanges={saveChanges}
                updateContent={updateContent}
              />

              <CardMetadataPanel
                actions={{
                  showMoreInfo: () => {
                    metrics.modalOpened("more_info");
                    setShowMoreInfoModal(true);
                  },
                  toggleFavorite,
                  openLink: card.url ? openLink : undefined,
                  downloadFile: canDownload ? downloadFile : undefined,
                  showNotesEditor: () => {
                    metrics.modalOpened("notes_edit");
                    setShowNotesEditModal(true);
                  },
                  showTagManager: () => {
                    metrics.modalOpened("tag_management");
                    setShowTagManagementModal(true);
                  },
                  deleteCard: () => handleDelete(handleClose),
                  restoreCard: () => handleRestore(handleClose),
                  permanentlyDeleteCard: () =>
                    handlePermanentDelete(handleClose),
                }}
                card={card}
                getCurrentValue={getCurrentValue}
                onCardTypeClick={handleCardTypeClick}
                onTagClick={onTagClick}
              />
            </div>

            <CardModalOverlays
              addTag={addTag}
              card={card}
              getCurrentValue={getCurrentValue}
              onMoreInfoChange={setShowMoreInfoModal}
              onNotesEditChange={setShowNotesEditModal}
              onTagManagementChange={setShowTagManagementModal}
              removeAiTag={removeAiTag}
              removeTag={removeTag}
              saveNotes={saveNotes}
              setTagInput={setTagInput}
              showMoreInfoModal={showMoreInfoModal}
              showNotesEditModal={showNotesEditModal}
              showTagManagementModal={showTagManagementModal}
              tagInput={tagInput}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <DialogTitle className="sr-only">Loading...</DialogTitle>
            <DialogDescription className="sr-only">
              Loading card details
            </DialogDescription>
            <Loading />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
