import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useCardModal } from "@/hooks/useCardModal";
import { CARD_TYPE_LABELS, type CardType } from "@teak/convex/shared/constants";
import { Loading } from "./Loading";
import { CardModalPreview } from "./card-modal/CardModalPreview";
import { CardMetadataPanel } from "./card-modal/CardMetadataPanel";
import { CardModalOverlays } from "./card-modal/CardModalOverlays";
import { metrics } from "@/lib/metrics";

interface CardModalProps {
  cardId: string | null;
  open: boolean;
  onCancel?: () => void;
  onCardTypeClick?: (cardType: string) => void;
  onTagClick?: (tag: string) => void;
}

export function CardModal({
  cardId,
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
    updateNotes,
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
    hasUnsavedChanges,
    getCurrentValue,
    isSaved,
  } = useCardModal(cardId, { onCardTypeClick });

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
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          void handleClose();
        }
      }}
    >
      <DialogContent className="md:max-w-7xl max-h-[calc(90vh-80px)] p-0 flex flex-col md:flex-row h-[calc(90vh-80px)] overflow-hidden gap-4 border-0 dark:border outline-0 focus-within:outline-0 shadow-none">
        {!card ? (
          <div className="flex flex-1 items-center justify-center">
            <DialogTitle className="sr-only">Loading...</DialogTitle>
            <Loading />
          </div>
        ) : (
          <>
            <DialogTitle className="sr-only">
              {CARD_TYPE_LABELS[card.type as CardType] || "Card"}
            </DialogTitle>

            <div className="flex flex-col md:flex-row gap-0 flex-1 overflow-hidden">
              <CardModalPreview
                card={card}
                hasUnsavedChanges={hasUnsavedChanges}
                isSaved={isSaved}
                saveChanges={saveChanges}
                updateContent={updateContent}
                getCurrentValue={getCurrentValue}
              />

              <CardMetadataPanel
                card={card}
                getCurrentValue={getCurrentValue}
                onCardTypeClick={handleCardTypeClick}
                onTagClick={onTagClick}
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
              />
            </div>

            <CardModalOverlays
              card={card}
              showTagManagementModal={showTagManagementModal}
              onTagManagementChange={setShowTagManagementModal}
              showMoreInfoModal={showMoreInfoModal}
              onMoreInfoChange={setShowMoreInfoModal}
              showNotesEditModal={showNotesEditModal}
              onNotesEditChange={setShowNotesEditModal}
              tagInput={tagInput}
              setTagInput={setTagInput}
              addTag={addTag}
              removeTag={removeTag}
              removeAiTag={removeAiTag}
              getCurrentValue={getCurrentValue}
              updateNotes={updateNotes}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
