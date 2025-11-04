import { Button } from "@/components/ui/button";
import { badgeVariants } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Download,
  ExternalLink,
  Heart,
  RotateCcw,
  Sparkles,
  Trash,
  Trash2,
  FileText,
  Link,
  Image,
  Video,
  Volume2,
  File,
  Palette,
  Quote,
  Info,
  Tag,
  Edit,
} from "lucide-react";
import { useState } from "react";
import { useCardModal } from "@/hooks/useCardModal";
import {
  type CardType,
  CARD_TYPE_LABELS,
  getCardTypeIcon,
} from "@teak/convex/shared/constants";
import {
  LinkPreview,
  ImagePreview,
  VideoPreview,
  AudioPreview,
  DocumentPreview,
  TextPreview,
  PalettePreview,
  QuotePreview,
} from "./card-previews";
import { Loading } from "./Loading";
import { TagManagementModal } from "./TagManagementModal";
import { MoreInformationModal } from "./MoreInformationModal";
import { NotesEditModal } from "./NotesEditModal";
import { cn } from "@/lib/utils";

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
    // State
    card,
    tagInput,
    setTagInput,

    // Field updates
    updateContent,
    updateNotes,
    toggleFavorite,

    // Tag management
    addTag,
    removeTag,
    removeAiTag,

    // Actions
    handleDelete,
    handleRestore,
    handlePermanentDelete,

    // Utilities
    openLink,
    downloadFile,
    handleCardTypeClick,

    // Save functionality
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

  // Icon component mapping for Lucide React icons
  const iconComponentMap = {
    FileText,
    Link,
    Image,
    Video,
    Volume2,
    File,
    Palette,
    Quote,
  } as const;

  const getCardTypeIconComponent = (cardType: CardType) => {
    const iconName = getCardTypeIcon(cardType) as keyof typeof iconComponentMap;
    return iconComponentMap[iconName] || FileText;
  };

  const renderPreview = () => {
    if (!card) return null;

    switch (card.type) {
      case "text":
        return (
          <TextPreview
            card={card}
            onContentChange={updateContent}
            getCurrentValue={getCurrentValue}
          />
        );
      case "quote":
        return (
          <QuotePreview
            card={card}
            onContentChange={updateContent}
            getCurrentValue={getCurrentValue}
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
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) {
          void handleClose();
        }
      }}
    >
      <DialogContent className="md:max-w-7xl max-h-[calc(90vh-80px)] p-4 flex flex-col md:flex-row h-[calc(90vh-80px)] outline-0 overflow-hidden gap-4 border-0 dark:border">
        {!card ? (
          <>
            <DialogTitle className="sr-only">Loading...</DialogTitle>
            <Loading />
          </>
        ) : (
          <>
            {/* Desktop Hidden Title */}
            <DialogTitle className="sr-only">
              {CARD_TYPE_LABELS[card.type as CardType] || "Card"}
            </DialogTitle>

            {/* Main Content Area */}
            <div className="flex flex-col md:flex-row gap-2 md:gap-4 flex-1 overflow-hidden">
              {/* Preview Area */}
              <div className="flex-1 md:flex-2 border rounded-md bg-muted overflow-hidden flex flex-col min-h-0 relative">
                <div className="flex-1 p-2 overflow-y-auto">
                  {renderPreview()}
                </div>
                <div className="pointer-events-none absolute bottom-4 right-4 flex flex-col items-end gap-1">
                  {hasUnsavedChanges && (
                    <Button
                      size="sm"
                      className="px-4 pointer-events-auto"
                      onClick={() => {
                        void saveChanges();
                      }}
                    >
                      Save changes
                    </Button>
                  )}
                  {!hasUnsavedChanges && isSaved && (
                    <span className="text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded-md shadow-sm">
                      Saved
                    </span>
                  )}
                </div>
              </div>

              {/* Metadata Panel */}
              <div className="flex-1 md:flex-1 flex flex-col overflow-hidden min-h-0">
                <div className="flex-1 overflow-y-auto px-1 gap-3 md:gap-5 flex flex-col">
                  {/* Notes (read-only) */}
                  {getCurrentValue("notes") && (
                    <div>
                      <Label>Notes</Label>
                      <p className="mt-1.5 px-3 py-2.5 bg-muted rounded-md border whitespace-pre-wrap">
                        {getCurrentValue("notes")}
                      </p>
                    </div>
                  )}

                  {/* AI Summary (read-only) */}
                  {card.aiSummary && (
                    <div>
                      <Label>Summary</Label>
                      <p className="mt-1.5 px-3 py-2.5 bg-muted rounded-md border whitespace-pre-wrap">
                        {getCurrentValue("aiSummary")}
                      </p>
                    </div>
                  )}

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1">
                    {/* Card Type Tag (non-dismissible) */}
                    {card.type && (
                      <button
                        onClick={handleCardTypeClick}
                        className={cn(
                          badgeVariants({ variant: "outline" }),
                          "cursor-pointer rounded-full px-3 py-1 gap-2 text-sm [&_svg]:size-3.5!"
                        )}
                      >
                        {(() => {
                          const IconComponent = getCardTypeIconComponent(
                            card.type as CardType
                          );
                          return <IconComponent />;
                        })()}
                        {CARD_TYPE_LABELS[card.type as CardType]}
                      </button>
                    )}

                    {/* User Tags (clickable) */}
                    {card.tags?.map((tag: string) => (
                      <button
                        key={tag}
                        onClick={() => onTagClick?.(tag)}
                        className={cn(
                          badgeVariants({ variant: "outline" }),
                          "cursor-pointer rounded-full px-3 py-1 gap-2 text-sm [&_svg]:size-3.5!"
                        )}
                      >
                        {tag}
                      </button>
                    )) || []}

                    {/* AI Tags (clickable) */}
                    {card.aiTags?.map((tag: string) => (
                      <button
                        key={`ai-${tag}`}
                        onClick={() => onTagClick?.(tag)}
                        className={cn(
                          badgeVariants({ variant: "outline" }),
                          "cursor-pointer rounded-full px-3 py-1 gap-2 text-sm [&_svg]:size-3.5!"
                        )}
                      >
                        <Sparkles />
                        {tag}
                      </button>
                    ))}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap gap-1">
                    {/* Info Button */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowMoreInfoModal(true)}
                    >
                      <Info />
                      <span>Info</span>
                    </Button>

                    {/* Favorite Button */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={toggleFavorite}
                    >
                      <Heart
                        className={`size-3 md:size-4 ${
                          card.isFavorited
                            ? "fill-destructive text-destructive"
                            : ""
                        }`}
                      />
                      <span>
                        {card.isFavorited ? "Unfavorite" : "Favorite"}
                      </span>
                    </Button>

                    {/* Open Link Button */}
                    {card.url && (
                      <Button variant="outline" size="sm" onClick={openLink}>
                        <ExternalLink />
                        <span>Open Link</span>
                      </Button>
                    )}

                    {/* Download Button */}
                    {card.fileId &&
                      (card.type === "document" ||
                        card.type === "audio" ||
                        card.type === "video" ||
                        card.type === "image") && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={downloadFile}
                        >
                          <Download />
                          <span>Download</span>
                        </Button>
                      )}

                    {/* Edit/Add Notes Button */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowNotesEditModal(true)}
                    >
                      <Edit />
                      <span>
                        {getCurrentValue("notes") ? "Edit Notes" : "Add Notes"}
                      </span>
                    </Button>

                    {/* Manage Tags Button */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowTagManagementModal(true)}
                    >
                      <Tag />
                      <span>Manage Tags</span>
                    </Button>

                    {/* Delete Actions */}
                    {!card.isDeleted && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(handleClose)}
                      >
                        <Trash2 />
                        <span>Delete</span>
                      </Button>
                    )}

                    {card.isDeleted && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRestore(handleClose)}
                        >
                          <RotateCcw />
                          <span>Restore</span>
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handlePermanentDelete(handleClose)}
                        >
                          <Trash />
                          <span>Delete Forever</span>
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Tag Management Modal */}
            <TagManagementModal
              open={showTagManagementModal}
              onOpenChange={setShowTagManagementModal}
              userTags={card?.tags || []}
              aiTags={card?.aiTags || []}
              tagInput={tagInput}
              setTagInput={setTagInput}
              onAddTag={addTag}
              onRemoveTag={removeTag}
              onRemoveAiTag={removeAiTag}
            />

            {/* More Information Modal */}
            <MoreInformationModal
              open={showMoreInfoModal}
              onOpenChange={setShowMoreInfoModal}
              card={card}
            />

            {/* Notes Edit Modal */}
            <NotesEditModal
              open={showNotesEditModal}
              onOpenChange={setShowNotesEditModal}
              notes={getCurrentValue("notes") || ""}
              onSave={(notes) => updateNotes(notes)}
              onCancel={() => {}}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
