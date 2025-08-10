import { useCallback, useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ExternalLink, Trash2, X } from "lucide-react";
import { api } from "../convex/_generated/api";
import type { CardData } from "./Card";
import {
  AudioCard,
  DocumentCard,
  ImageCard,
  LinkCard,
  VideoCard,
} from "./CardTypes";

interface CardModalProps {
  card: CardData | null;
  open: boolean;
  onCancel?: () => void;
  onDelete?: (cardId: string) => void;
}

export function CardModal({
  card,
  open,
  onCancel,
  onDelete,
}: CardModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form data initialized with card data
  const [title, setTitle] = useState(card?.title || "");
  const [content, setContent] = useState(card?.content || "");
  const [url, setUrl] = useState(card?.url || "");
  const [tags, setTags] = useState<string[]>(card?.tags || []);
  const [tagInput, setTagInput] = useState("");
  const [description, setDescription] = useState(card?.description || "");

  // Reset form when card changes
  useEffect(() => {
    if (card) {
      setTitle(card.title || "");
      setContent(card.content || "");
      setUrl(card.url || "");
      setTags(card.tags || []);
      setTagInput("");
      setDescription(card.description || "");
    }
  }, [card]);


  const updateCard = useMutation(api.cards.updateCard);


  const saveCard = async (updates: Partial<{ title: string; content: string; url: string; tags: string[]; description: string }>) => {
    if (!card) return;

    setIsSubmitting(true);
    try {
      await updateCard({
        id: card._id as any,
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
    if (card && confirm("Are you sure you want to delete this card?")) {
      onDelete?.(card._id);
      onCancel?.();
    }
  };

  const openLink = () => {
    if (card?.url) {
      window.open(card.url, "_blank", "noopener,noreferrer");
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
          <div className="h-full">
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
          </div>
        );

      case "link":
        return (
          <div className="space-y-4">
            <LinkCard card={{ ...card, content, title: title || card.title }} />
            {content !== card.content && (
              <div>
                <Label className="text-sm font-medium">Notes</Label>
                <Textarea
                  value={content}
                  onChange={(e) => {
                const newContent = e.target.value;
                setContent(newContent);
                saveCard({ content: newContent.trim() });
              }}
                  placeholder="Add your notes about this link..."
                  className="mt-1 min-h-[100px]"
                />
              </div>
            )}
          </div>
        );

      case "image":
        return (
          <div className="space-y-4">
            <ImageCard card={card} />
          </div>
        );

      case "video":
        return (
          <div className="space-y-4">
            <VideoCard card={card} />
            {content && (
              <div>
                <Label className="text-sm font-medium">Description</Label>
                <Textarea
                  value={content}
                  onChange={(e) => {
                const newContent = e.target.value;
                setContent(newContent);
                saveCard({ content: newContent.trim() });
              }}
                  placeholder="Add a description for this video..."
                  className="mt-1 min-h-[100px]"
                />
              </div>
            )}
          </div>
        );

      case "audio":
        return (
          <div className="space-y-4">
            <div className="text-center">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Audio Recording</h3>
              <AudioCard card={card} />
            </div>
          </div>
        );

      case "document":
        return (
          <div className="space-y-4">
            <DocumentCard card={card} />
          </div>
        );

      default:
        return <div>Unknown card type</div>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        className="md:max-w-6xl max-h-[90vh] p-0"
        showCloseButton={false}
      >
        <div className="flex h-[80vh]">
          {/* Preview Area (Left 2/3) */}
          <div className="flex-[2] p-6 border-r overflow-y-auto">
            <div className="h-full flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <DialogTitle className="text-lg font-semibold">
                  {card.type.charAt(0).toUpperCase() + card.type.slice(1)}{" "}
                  Preview
                </DialogTitle>
                <div className="flex items-center gap-2">
                  {isSubmitting && (
                    <span className="text-xs text-blue-600 font-medium">
                      Saving...
                    </span>
                  )}
                  {card.url && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openLink}
                      className="flex items-center gap-2"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Open
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex-1">
                {renderPreview()}
              </div>
            </div>
          </div>

          {/* Metadata Panel (Right 1/3) */}
          <div className="flex-1 p-6 bg-gray-50/50 overflow-y-auto">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <DialogTitle className="text-lg font-semibold">
                  Details
                </DialogTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClose}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Title */}
              <div>
                <Label htmlFor="modal-title">Title</Label>
                <Input
                  id="modal-title"
                  value={title}
                  onChange={(e) => {
                    const newTitle = e.target.value;
                    setTitle(newTitle);
                    saveCard({ title: newTitle.trim() || undefined });
                  }}
                  placeholder="Enter a title for your content"
                  className="mt-1"
                />
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

              {/* Description */}
              <div>
                <Label htmlFor="modal-description">Description</Label>
                <Input
                  id="modal-description"
                  value={description}
                  onChange={(e) => {
                    const newDescription = e.target.value;
                    setDescription(newDescription);
                    saveCard({ description: newDescription.trim() || undefined });
                  }}
                  placeholder="Add a description or additional notes..."
                  className="mt-1"
                />
              </div>

              {/* Tags */}
              <div>
                <Label htmlFor="modal-tags">Tags</Label>
                <div className="flex flex-wrap gap-2 mt-1 mb-2">
                  {tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="cursor-pointer hover:bg-secondary/80"
                    >
                      #{tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="ml-1 hover:text-destructive"
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

              <Separator />

              {/* File Metadata (read-only) */}
              <div className="space-y-2 text-sm text-gray-600">
                <div>
                  <span className="font-medium">Type:</span> {card.type}
                </div>
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
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  className="w-full"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Card
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

