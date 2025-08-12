import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Archive,
  ChevronDown,
  ChevronUp,
  Code,
  ExternalLink,
  File,
  FileText,
  Heart,
  RotateCcw,
  Sparkles,
  Trash,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../convex/_generated/api";
import { type Doc } from "../convex/_generated/dataModel";

// Legacy shim removed after migration

// Large/rich previews for the modal
function getDocumentIcon(fileName: string, mimeType: string) {
  const name = (fileName || "").toLowerCase();
  const mime = (mimeType || "").toLowerCase();

  if (mime.includes("pdf")) {
    return <FileText className="w-10 h-10 text-red-500" />;
  }
  if (
    mime.includes("word") ||
    name.endsWith(".doc") ||
    name.endsWith(".docx")
  ) {
    return <FileText className="w-10 h-10 text-blue-500" />;
  }
  if (
    mime.includes("excel") ||
    name.endsWith(".xls") ||
    name.endsWith(".xlsx")
  ) {
    return <FileText className="w-10 h-10 text-green-500" />;
  }
  if (
    mime.includes("powerpoint") ||
    name.endsWith(".ppt") ||
    name.endsWith(".pptx")
  ) {
    return <FileText className="w-10 h-10 text-orange-500" />;
  }
  if (
    mime.includes("zip") ||
    mime.includes("rar") ||
    name.endsWith(".7z") ||
    name.endsWith(".tar.gz")
  ) {
    return <Archive className="w-10 h-10 text-yellow-500" />;
  }
  if (
    name.endsWith(".js") ||
    name.endsWith(".ts") ||
    name.endsWith(".py") ||
    name.endsWith(".html") ||
    name.endsWith(".css") ||
    name.endsWith(".json") ||
    name.endsWith(".xml")
  ) {
    return <Code className="w-10 h-10 text-green-500" />;
  }
  if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".rtf")) {
    return <FileText className="w-10 h-10 text-muted-foreground" />;
  }
  return <File className="w-10 h-10 text-muted-foreground" />;
}

function ModalLinkPreview({ card }: { card: Doc<"cards"> }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://www.google.com/s2/favicons?domain=${card.url}`}
          alt=""
          className="w-5 h-5 mt-0.5 flex-shrink-0"
        />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-lg leading-tight line-clamp-2">
            {card.metadata?.linkTitle || card.url || "Link"}
          </h2>
          {card.url && (
            <p className="text-muted-foreground truncate">{card.url}</p>
          )}
        </div>
      </div>
      {card.metadata?.linkImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={card.metadata.linkImage}
          alt=""
          className="w-full max-h-[60vh] object-cover rounded"
        />
      )}
      {card.notes && (
        <p className="text-base text-muted-foreground whitespace-pre-wrap">
          {card.notes}
        </p>
      )}
    </div>
  );
}

function ModalImagePreview({ card }: { card: Doc<"cards"> }) {
  const fileUrl = useQuery(
    api.cards.getFileUrl,
    card.fileId ? { fileId: card.fileId } : "skip"
  );
  if (!fileUrl) return null;
  return (
    <div className="w-full h-full flex items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={fileUrl}
        alt={card.content}
        className="max-h-[70vh] max-w-full object-contain"
      />
    </div>
  );
}

function ModalVideoPreview({ card }: { card: Doc<"cards"> }) {
  const fileUrl = useQuery(
    api.cards.getFileUrl,
    card.fileId ? { fileId: card.fileId } : "skip"
  );
  if (!fileUrl) return null;
  return (
    <video controls className="w-full bg-black max-h-[70vh]" preload="metadata">
      <source src={fileUrl} type={card.metadata?.mimeType} />
      Your browser does not support the video tag.
    </video>
  );
}

function ModalAudioPreview({ card }: { card: Doc<"cards"> }) {
  const [isTranscriptCollapsed, setIsTranscriptCollapsed] = useState(false);
  const fileUrl = useQuery(
    api.cards.getFileUrl,
    card.fileId ? { fileId: card.fileId } : "skip"
  );

  if (!fileUrl) return null;

  return (
    <div className="p-2 space-y-4">
      <audio controls className="w-full">
        <source src={fileUrl} type={card.metadata?.mimeType} />
        Your browser does not support the audio element.
      </audio>

      {/* Transcript Section */}
      {card.transcript && (
        <div className="border rounded-lg">
          <button
            onClick={() => setIsTranscriptCollapsed(!isTranscriptCollapsed)}
            className="w-full p-3 flex items-center justify-between text-left bg-gray-50 hover:bg-gray-100 rounded-t-lg transition-colors"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-500" />
              <span className="font-medium">Transcript</span>
            </div>
            {isTranscriptCollapsed ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronUp className="w-4 h-4" />
            )}
          </button>

          {!isTranscriptCollapsed && (
            <div className="p-3 max-h-64 overflow-y-auto">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {card.transcript}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModalDocumentPreview({ card }: { card: Doc<"cards"> }) {
  const fileName = card.metadata?.fileName || card.content || "Document";
  const mimeType = card.metadata?.mimeType || "";
  return (
    <div className="flex items-center gap-4 p-4">
      <div className="flex-shrink-0">{getDocumentIcon(fileName, mimeType)}</div>
      <div className="min-w-0">
        <p className="font-medium text-lg truncate">{fileName}</p>
        {mimeType && (
          <p className="text-muted-foreground truncate">{mimeType}</p>
        )}
      </div>
    </div>
  );
}

interface CardModalProps {
  card: Doc<"cards"> | null;
  open: boolean;
  onCancel?: () => void;
  onDelete?: (cardId: string) => void;
  onRestore?: (cardId: string) => void;
  onPermanentDelete?: (cardId: string) => void;
  onToggleFavorite?: (cardId: string) => void;
  isTrashMode?: boolean;
}

export function CardModal({
  card,
  open,
  onCancel,
  onDelete,
  onRestore,
  onPermanentDelete,
  onToggleFavorite,
}: CardModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFavorited, setIsFavorited] = useState(card?.isFavorited || false);

  // Form data initialized with card data
  const [content, setContent] = useState(card?.content || "");
  const [url, setUrl] = useState(card?.url || "");
  const [tags, setTags] = useState<string[]>(card?.tags || []);
  const [tagInput, setTagInput] = useState("");
  const [notes, setNotes] = useState(card?.notes || "");
  const [aiSummary, setAiSummary] = useState(card?.aiSummary || "");

  // Reset form when card changes
  useEffect(() => {
    if (card) {
      setContent(card.content || "");
      setUrl(card.url || "");
      setTags(card.tags || []);
      setTagInput("");
      setNotes(card.notes || "");
      setAiSummary(card.aiSummary || "");
      setIsFavorited(card.isFavorited || false);
    }
  }, [card]);

  const updateCard = useMutation(api.cards.updateCard);
  const removeAiTag = useMutation(api.cards.removeAiTag);
  const updateAiSummary = useMutation(api.cards.updateAiSummary);

  const saveCard = async (
    updates: Partial<{
      content: string;
      url: string;
      tags: string[];
      notes: string;
    }>
  ) => {
    if (!card) return;

    setIsSubmitting(true);
    try {
      await updateCard({
        id: card._id,
        ...updates,
      });
    } catch (error) {
      console.error("Failed to update card:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    onCancel?.();
  };

  const handleDelete = () => {
    if (card) {
      onDelete?.(card._id);
      onCancel?.();
    }
  };

  const handleRestore = () => {
    if (card) {
      onRestore?.(card._id);
      onCancel?.();
    }
  };

  const handlePermanentDelete = () => {
    if (card) {
      onPermanentDelete?.(card._id);
      onCancel?.();
    }
  };

  const handleToggleFavorite = () => {
    if (card) {
      setIsFavorited(!isFavorited);
      onToggleFavorite?.(card._id);
    }
  };

  const openLink = () => {
    if (card?.url) {
      window.open(card.url, "_blank", "noopener,noreferrer");
    }
  };

  const handleRemoveAiTag = async (tagToRemove: string) => {
    if (!card) return;
    try {
      await removeAiTag({
        cardId: card._id,
        tagToRemove,
      });
    } catch (error) {
      console.error("Error removing AI tag:", error);
    }
  };

  const handleUpdateAiSummary = async (newSummary: string) => {
    if (!card) return;
    try {
      await updateAiSummary({
        cardId: card._id,
        newSummary,
      });
    } catch (error) {
      console.error("Error updating AI summary:", error);
    }
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      const newTags = [...tags, tag];
      setTags(newTags);
      setTagInput("");
      saveCard({ tags: newTags.length > 0 ? newTags : undefined });
    }
  };

  const removeTag = (tagToRemove: string) => {
    const newTags = tags.filter((tag) => tag !== tagToRemove);
    setTags(newTags);
    saveCard({ tags: newTags.length > 0 ? newTags : undefined });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      addTag();
    } else if (e.key === "Escape") {
      handleClose();
    }
  };

  // Don't render if no card
  if (!card) return null;

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
    switch (card.type) {
      case "text":
        return (
          <Textarea
            value={content}
            onChange={(e) => {
              const newContent = e.target.value;
              setContent(newContent);
              saveCard({ content: newContent.trim() });
            }}
            placeholder="Enter your text..."
            className="h-full resize-none text-base leading-relaxed"
          />
        );

      case "link":
        return <ModalLinkPreview card={{ ...card, content }} />;

      case "image":
        return <ModalImagePreview card={card} />;

      case "video":
        return <ModalVideoPreview card={card} />;

      case "audio":
        return <ModalAudioPreview card={card} />;

      case "document":
        return <ModalDocumentPreview card={card} />;

      default:
        return <div>Unknown card type</div>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        className="md:max-w-6xl max-h-[90vh] p-0 flex h-[80vh] gap-0"
        showCloseButton={false}
      >
        {/* Preview Area (Left 2/3) */}
        <div className="flex-[2] p-4 border-r overflow-y-auto h-full">
          <div className="flex-1 h-full">{renderPreview()}</div>
        </div>

        {/* Metadata Panel (Right 1/3) */}
        <div className="flex-1 flex flex-col p-4 bg-gray-50/50 overflow-y-auto gap-6">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-semibold">
              {card.type.charAt(0).toUpperCase() + card.type.slice(1)} Card
            </DialogTitle>
            <div className="flex items-center gap-2">
              {isSubmitting && (
                <span className="text-primary font-medium">Saving...</span>
              )}
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
                value={url}
                onChange={(e) => {
                  const newUrl = e.target.value;
                  setUrl(newUrl);
                  saveCard({ url: newUrl.trim() || undefined });
                }}
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
              value={notes}
              onChange={(e) => {
                const newNotes = e.target.value;
                setNotes(newNotes);
                saveCard({
                  notes: newNotes.trim() || undefined,
                });
              }}
              placeholder="Add notes..."
              className="mt-1"
            />
          </div>

          {/* Tags */}
          <div>
            <Label htmlFor="modal-tags">Tags</Label>
            <div className="flex flex-wrap gap-1 my-1.5">
              {tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                  <button type="button" onClick={() => removeTag(tag)}>
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
              {card.aiTags?.map((tag) => (
                <Badge key={`ai-${tag}`} variant="outline">
                  <Sparkles />
                  {tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveAiTag(tag)}
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
              onKeyDown={handleKeyDown}
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
                value={aiSummary}
                onChange={(e) => {
                  const newSummary = e.target.value;
                  setAiSummary(newSummary);
                }}
                onBlur={() => handleUpdateAiSummary(aiSummary)}
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
                <Button variant="outline" onClick={handleToggleFavorite}>
                  <Heart
                    className={`${
                      isFavorited ? "fill-red-500 text-red-500" : ""
                    }`}
                  />
                  {isFavorited ? "Unfavorite" : "Favorite"}
                </Button>
                <Button variant="destructive" onClick={handleDelete}>
                  <Trash2 />
                  Delete
                </Button>
              </>
            )}

            {card.isDeleted && (
              <>
                <Button variant="outline" onClick={handleRestore}>
                  <RotateCcw />
                  Restore
                </Button>
                <Button variant="destructive" onClick={handlePermanentDelete}>
                  <Trash />
                  Delete Forever
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
