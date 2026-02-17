import { CARD_TYPE_LABELS, type CardType } from "@teak/convex/shared/constants";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@teak/ui/components/ui/dialog";
import { Loading } from "@teak/ui/feedback/Loading";
import {
  AudioPreview,
  DocumentPreview,
  ImagePreview,
  LinkPreview,
  PalettePreview,
  QuotePreview,
  TextPreview,
  VideoPreview,
} from "../card-previews";
import { CardMetadataPanel } from "./CardMetadataPanel";
import type { CardModalCard, GetCurrentValue } from "./types";

interface CardModalProps {
  card?: CardModalCard | null;
  downloadFile: () => void;
  getCurrentValue: GetCurrentValue;
  handleDelete: (onClose?: () => void) => Promise<void>;
  handlePermanentDelete: (onClose?: () => void) => Promise<void>;
  handleRestore: (onClose?: () => void) => Promise<void>;
  hasUnsavedChanges: boolean;
  MoreInformationModal: React.ReactNode;
  NotesEditModal: React.ReactNode;
  onCancel?: () => void;
  onCardTypeClick?: (cardType: string) => void;
  onTagClick?: (tag: string) => void;
  open: boolean;
  openLink: () => void;
  saveChanges: () => Promise<void>;
  setShowMoreInfoModal: (open: boolean) => void;
  setShowNotesEditModal: (open: boolean) => void;
  setShowTagManagementModal: (open: boolean) => void;
  showMoreInfoModal: boolean;
  showNotesEditModal: boolean;
  showTagManagementModal: boolean;
  TagManagementModal: React.ReactNode;
  toggleFavorite: () => void;
  updateContent: (value: string) => void;
}

export function CardModal({
  card: cardData,
  open,
  onCancel,
  onCardTypeClick,
  onTagClick,
  hasUnsavedChanges,
  getCurrentValue,
  updateContent,
  toggleFavorite,
  handleDelete,
  handleRestore,
  handlePermanentDelete,
  openLink,
  downloadFile,
  saveChanges,
  setShowTagManagementModal,
  setShowMoreInfoModal,
  setShowNotesEditModal,
  TagManagementModal,
  MoreInformationModal,
  NotesEditModal,
}: CardModalProps) {
  const card = cardData;

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

  const handleCardTypeClick = () => {
    if (card?.type) {
      onCardTypeClick?.(card.type);
    }
  };

  const renderPreview = () => {
    if (!card) return null;

    switch (card.type) {
      case "text":
        return (
          <TextPreview
            card={card}
            getCurrentValue={getCurrentValue}
            onContentChange={updateContent}
          />
        );
      case "quote":
        return (
          <QuotePreview
            card={card}
            getCurrentValue={getCurrentValue}
            onContentChange={updateContent}
          />
        );
      case "link":
        return <LinkPreview card={card} showScreenshot />;
      case "image":
        return <ImagePreview card={card} />;
      case "video":
        return <VideoPreview card={card} />;
      case "audio":
        return <AudioPreview card={card} />;
      case "document":
        return <DocumentPreview card={card} />;
      case "palette":
        return <PalettePreview card={card} />;
      default:
        return <div>{card.content}</div>;
    }
  };

  return (
    <>
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
                <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden md:flex-2 md:border-r">
                  <div className="flex-1 overflow-y-auto p-4">
                    {renderPreview()}
                  </div>
                  <div className="pointer-events-none absolute right-4 bottom-4 flex flex-col items-end gap-1">
                    {hasUnsavedChanges && (
                      <button
                        className="pointer-events-auto rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm"
                        onClick={() => {
                          void saveChanges();
                        }}
                        type="button"
                      >
                        Save changes
                      </button>
                    )}
                  </div>
                </div>

                <CardMetadataPanel
                  actions={{
                    showMoreInfo: () => {
                      setShowMoreInfoModal(true);
                    },
                    toggleFavorite,
                    openLink: card.url ? openLink : undefined,
                    downloadFile: canDownload ? downloadFile : undefined,
                    showNotesEditor: () => {
                      setShowNotesEditModal(true);
                    },
                    showTagManager: () => {
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

      {TagManagementModal}
      {MoreInformationModal}
      {NotesEditModal}
    </>
  );
}
