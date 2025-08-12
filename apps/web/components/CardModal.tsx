import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  ExternalLink,
  Heart,
  RotateCcw,
  Sparkles,
  Trash,
  Trash2,
  X,
} from "lucide-react";
import { useCardModal } from "@/hooks/useCardModal";
import {
  LinkPreview,
  ImagePreview,
  VideoPreview,
  AudioPreview,
  DocumentPreview,
  TextPreview,
} from "./card-previews";
import { Loading } from "./Loading";

interface CardModalProps {
  cardId: string | null;
  open: boolean;
  onCancel?: () => void;
}

export function CardModal({ cardId, open, onCancel }: CardModalProps) {
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
    handleKeyDown,
  } = useCardModal(cardId);

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

  const renderPreview = () => {
    if (!card) return null;
    
    switch (card.type) {
      case "text":
        return <TextPreview card={card} onContentChange={updateContent} />;
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
      default:
        return <div>Unknown card type</div>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        className="md:max-w-6xl max-h-[90vh] p-3 flex h-[80vh] outline-0 border-0 overflow-hidden gap-3"
        showCloseButton={false}
      >
        {!card ? (
          <>
            <DialogTitle className="sr-only">Loading...</DialogTitle>
            <Loading />
          </>
        ) : (
          <>
            {/* Preview Area (Left 2/3) */}
            <div className="flex-[2] p-1 overflow-y-auto h-full">
              <div className="flex-1 h-full">{renderPreview()}</div>
            </div>

            {/* Metadata Panel (Right 1/3) */}
            <div className="flex-1 flex flex-col p-3 border rounded-md bg-gray-50/50 overflow-y-auto gap-5">
              <div className="flex items-center justify-between">
                <DialogTitle className="text-lg font-semibold">
                  {card.type.charAt(0).toUpperCase() + card.type.slice(1)} Card
                </DialogTitle>
                <div className="flex items-center gap-2">
                  {card.url && (
                    <Button variant="outline" size="sm" onClick={openLink}>
                      <ExternalLink />
                      Open
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={handleClose}>
                    <X />
                  </Button>
                </div>
              </div>

              {/* URL (for links or any card with URL) */}
              {(card.type === "link" || card.url) && (
                <div>
                  <Label htmlFor="modal-url">URL</Label>
                  <Input
                    id="modal-url"
                    type="url"
                    value={card.url || ""}
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
                  value={card.notes || ""}
                  onChange={(e) => updateNotes(e.target.value)}
                  placeholder="Add notes..."
                  className="mt-1"
                />
              </div>

              {/* Tags */}
              <div>
                <Label htmlFor="modal-tags">Tags</Label>
                <div className="flex flex-wrap gap-1 my-1.5">
                  {card.tags?.map((tag) => (
                    <Badge
                      key={tag}
                      variant="outline"
                      className="flex items-center gap-1"
                    >
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)}>
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  )) || []}
                  {card.aiTags?.map((tag) => (
                    <Badge
                      key={`ai-${tag}`}
                      variant="outline"
                      className="flex items-center gap-1"
                    >
                      <Sparkles className="w-3 h-3" />
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeAiTag(tag)}
                        title="Remove AI tag"
                      >
                        <X className="w-3 h-3" />
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

              {/* AI Summary */}
              {card.aiSummary && (
                <div>
                  <Label htmlFor="ai-summary">Teak Summary</Label>
                  <Textarea
                    id="ai-summary"
                    value={card.aiSummary || ""}
                    onChange={(e) => updateAiSummary(e.target.value)}
                    placeholder="AI generated summary..."
                    className="mt-1"
                    rows={3}
                  />
                </div>
              )}

              <Separator />

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

                {card.metadata?.fileSize && (
                  <div>
                    <span className="font-medium">File Size:</span>{" "}
                    {(card.metadata.fileSize / (1024 * 1024)).toFixed(2)} MB
                  </div>
                )}

                {card.metadata?.fileName && (
                  <div>
                    <span className="font-medium">File Name:</span>{" "}
                    {card.metadata.fileName}
                  </div>
                )}

                {card.metadata?.mimeType && (
                  <div>
                    <span className="font-medium">File Type:</span>{" "}
                    {card.metadata.mimeType}
                  </div>
                )}
              </div>

              <Separator />

              {/* Action Buttons */}
              <div className="flex gap-2">
                {!card.isDeleted && (
                  <>
                    <Button variant="outline" onClick={toggleFavorite}>
                      <Heart
                        className={`${
                          card.isFavorited ? "fill-red-500 text-red-500" : ""
                        }`}
                      />
                      {card.isFavorited ? "Unfavorite" : "Favorite"}
                    </Button>
                    <Button
                      variant="destructive"
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
                      onClick={() => handleRestore(handleClose)}
                    >
                      <RotateCcw />
                      Restore
                    </Button>
                    <Button
                      variant="destructive"
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
