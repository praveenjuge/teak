import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Check,
  Download,
  ExternalLink,
  Heart,
  RotateCcw,
  Save,
  Sparkles,
  Trash,
  Trash2,
  X,
  FileText,
  Link,
  Image,
  Video,
  Volume2,
  File,
  Palette,
} from "lucide-react";
import { useCardModal } from "@/hooks/useCardModal";
import { type CardType, CARD_TYPE_LABELS } from "@teak/shared/constants";
import {
  LinkPreview,
  ImagePreview,
  VideoPreview,
  AudioPreview,
  DocumentPreview,
  TextPreview,
  PalettePreview,
} from "./card-previews";
import { Loading } from "./Loading";

interface CardModalProps {
  cardId: string | null;
  open: boolean;
  onCancel?: () => void;
  onCardTypeClick?: (cardType: string) => void;
}

export function CardModal({
  cardId,
  open,
  onCancel,
  onCardTypeClick,
}: CardModalProps) {
  const {
    // State
    card,
    tagInput,
    setTagInput,

    // Field updates
    updateContent,
    updateUrl,
    updateNotes,
    updateAiSummary,
    toggleFavorite,
    removeAiTag,

    // Tag management
    removeTag,

    // Actions
    handleDelete,
    handleRestore,
    handlePermanentDelete,

    // Utilities
    openLink,
    downloadFile,
    handleKeyDown,
    handleCardTypeClick,

    // Save functionality
    saveChanges,
    hasUnsavedChanges,
    getCurrentValue,
    isSaved,
  } = useCardModal(cardId, { onCardTypeClick });

  const handleClose = () => {
    onCancel?.();
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getCardTypeIcon = (cardType: CardType) => {
    switch (cardType) {
      case "text":
        return FileText;
      case "link":
        return Link;
      case "image":
        return Image;
      case "video":
        return Video;
      case "audio":
        return Volume2;
      case "document":
        return File;
      case "palette":
        return Palette;
      default:
        return FileText;
    }
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
      case "link":
        return <LinkPreview card={card} />;
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
        return <div>Unknown card type</div>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        className="md:max-w-7xl max-h-[90vh] p-3 flex flex-col md:flex-row h-[90vh] outline-0 overflow-hidden gap-4 border-0"
        showCloseButton={false}
      >
        {!card ? (
          <>
            <DialogTitle className="sr-only">Loading...</DialogTitle>
            <Loading />
          </>
        ) : (
          <>
            {/* Preview Area (Top on mobile, Left 2/3 on desktop) */}
            <div className="flex-1 md:flex-[2] p-3 border rounded-md bg-muted/50 overflow-y-auto h-full">
              <div className="flex-1 h-full">{renderPreview()}</div>
            </div>

            {/* Metadata Panel (Bottom on mobile, Right 1/3 on desktop) */}
            <div className="flex-1 flex flex-col overflow-y-auto p-1 gap-5">
              {/* URL (for links or any card with URL) */}
              {(card.type === "link" || card.url) && (
                <div>
                  <Label htmlFor="modal-url">URL</Label>
                  <Input
                    id="modal-url"
                    type="url"
                    value={getCurrentValue("url") || ""}
                    onChange={(e) => updateUrl(e.target.value)}
                    placeholder="https://example.com"
                    className="mt-1"
                  />
                </div>
              )}

              {/* Notes */}
              <div>
                <Label htmlFor="modal-notes">Notes</Label>
                <Input
                  id="modal-notes"
                  value={getCurrentValue("notes") || ""}
                  onChange={(e) => updateNotes(e.target.value)}
                  placeholder="Add notes..."
                  className="mt-1"
                />
              </div>

              {/* AI Summary */}
              {card.aiSummary && (
                <div>
                  <Label htmlFor="ai-summary">Summary</Label>
                  <Textarea
                    id="ai-summary"
                    value={getCurrentValue("aiSummary") || ""}
                    onChange={(e) => updateAiSummary(e.target.value)}
                    placeholder="AI generated summary..."
                    className="mt-1"
                    rows={3}
                  />
                </div>
              )}

              {/* Tags */}
              <div>
                <Label htmlFor="modal-tags">Tags</Label>
                <div className="flex flex-wrap gap-1 my-1.5">
                  {/* Card Type Tag (non-dismissible) */}
                  {card.type && (
                    <Badge
                      variant="outline"
                      className="cursor-pointer flex items-center gap-1"
                      onClick={handleCardTypeClick}
                    >
                      {(() => {
                        const IconComponent = getCardTypeIcon(
                          card.type as CardType
                        );
                        return <IconComponent className="size-3" />;
                      })()}
                      {CARD_TYPE_LABELS[card.type as CardType]}
                    </Badge>
                  )}

                  {card.tags?.map((tag: string) => (
                    <Badge
                      key={tag}
                      variant="outline"
                      className="flex items-center gap-1"
                    >
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)}>
                        <X className="size-3" />
                      </button>
                    </Badge>
                  )) || []}
                  {card.aiTags?.map((tag: string) => (
                    <Badge
                      key={`ai-${tag}`}
                      variant="outline"
                      className="flex items-center gap-1"
                    >
                      <Sparkles className="size-3" />
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeAiTag(tag)}
                        title="Remove AI tag"
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <Input
                  id="modal-tags"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, handleClose)}
                  placeholder="Add tags (press Enter)"
                  className="mt-1"
                />
              </div>

              {(hasUnsavedChanges || isSaved) && (
                <Button
                  variant={isSaved ? "outline" : "default"}
                  size="sm"
                  onClick={saveChanges}
                  disabled={isSaved}
                >
                  {isSaved ? (
                    <>
                      <Check />
                      Saved!
                    </>
                  ) : (
                    <>
                      <Save />
                      Save
                    </>
                  )}
                </Button>
              )}

              {/* File Metadata (read-only) */}
              <div className="space-y-2 text-muted-foreground">
                <div>
                  <span className="font-medium">Created:</span>{" "}
                  {formatDate(card.createdAt)}
                </div>
                <div>
                  <span className="font-medium">Updated:</span>{" "}
                  {formatDate(card.updatedAt)}
                </div>

                {card.fileMetadata?.fileSize && (
                  <div>
                    <span className="font-medium">File Size:</span>{" "}
                    {(card.fileMetadata.fileSize / (1024 * 1024)).toFixed(2)} MB
                  </div>
                )}

                {card.fileMetadata?.fileName && (
                  <div>
                    <span className="font-medium">File Name:</span>{" "}
                    {card.fileMetadata.fileName}
                  </div>
                )}

                {card.fileMetadata?.mimeType && (
                  <div>
                    <span className="font-medium">File Type:</span>{" "}
                    {card.fileMetadata.mimeType}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2">
                {card.url && (
                  <Button variant="outline" size="sm" onClick={openLink}>
                    <ExternalLink />
                    Open Link
                  </Button>
                )}

                {card.fileId &&
                  (card.type === "document" ||
                    card.type === "audio" ||
                    card.type === "video" ||
                    card.type === "image") && (
                    <Button variant="outline" size="sm" onClick={downloadFile}>
                      <Download />
                      Download
                    </Button>
                  )}

                {!card.isDeleted && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={toggleFavorite}
                    >
                      <Heart
                        className={`${
                          card.isFavorited
                            ? "fill-destructive text-destructive"
                            : ""
                        }`}
                      />
                      {card.isFavorited ? "Unfavorite" : "Favorite"}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(handleClose)}
                    >
                      <Trash2 />
                      Delete
                    </Button>
                  </>
                )}

                {card.isDeleted && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRestore(handleClose)}
                    >
                      <RotateCcw />
                      Restore
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handlePermanentDelete(handleClose)}
                    >
                      <Trash />
                      Delete Forever
                    </Button>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
