import type { Card as CardType } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { ExternalLink, Trash2, Play, Clock } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { apiClient } from "@/lib/api";
import { useState } from "react";

interface CardItemProps {
  card: CardType;
  onDelete?: () => void;
}

// Helper function to format duration
const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
};

export function CardItem({ card, onDelete }: CardItemProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleDelete = async () => {
    if (isDeleting) return;

    try {
      setIsDeleting(true);
      await apiClient.deleteCard(card.id);
      onDelete?.();
    } catch (error) {
      console.error("Failed to delete card:", error);
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  const handleUrlClick = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // Render content based on card type
  const renderCardContent = () => {
    switch (card.type) {
      case "image":
        if (!card.data.media_url) return null;
        return (
          <div className="aspect-video bg-muted rounded overflow-hidden">
            <img
              src={card.data.media_url}
              alt={card.data.alt_text || "Image"}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
        );

      case "video":
        return (
          <div className="aspect-video bg-muted rounded overflow-hidden relative">
            {card.data.media_url ? (
              // For now, we'll show a gray background as video placeholder
              // In the future, this could be a video thumbnail
              <div className="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center"></div>
            ) : (
              <div className="w-full h-full bg-muted flex items-center justify-center"></div>
            )}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-black/60 rounded-full p-3">
                <Play className="size-4 text-white fill-white" />
              </div>
            </div>
            {card.data.duration && (
              <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
                {formatDuration(card.data.duration)}
              </div>
            )}
          </div>
        );

      case "audio":
        return (
          <div className="flex items-center justify-between p-4 w-full space-x-4">
            <div className="bg-primary rounded-full p-2">
              <Play className="size-4 text-primary-foreground fill-current" />
            </div>
            <div className="flex items-center space-x-2 text-muted-foreground">
              <Clock className="w-4 h-4" />
              <span className="text-sm">
                {card.data.duration
                  ? formatDuration(card.data.duration)
                  : "Audio"}
              </span>
            </div>
          </div>
        );

      case "url":
        if (!card.data.url) return null;
        return (
          <div
            className="flex items-center p-4 cursor-pointer transition-colors space-x-2 text-primary truncate"
            onClick={() => handleUrlClick(card.data.url)}
          >
            <ExternalLink className="size-4" />
            <span className="font-medium truncate max-w-xs">
              {card.data.title || card.data.url}
            </span>
          </div>
        );

      case "text":
        if (!card.data.content) return null;
        return (
          <p className="text-sm text-muted-foreground leading-relaxed p-4">
            {card.data.content}
          </p>
        );

      default:
        return (
          <p className="text-sm text-muted-foreground leading-relaxed p-4">
            {card.data.content}
          </p>
        );
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <Card className="relative overflow-hidden p-0">
          <CardContent className="p-0">{renderCardContent()}</CardContent>
        </Card>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onClick={() => setShowDeleteDialog(true)}
          disabled={isDeleting}
        >
          <Trash2 />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Card</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this card? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ContextMenu>
  );
}
