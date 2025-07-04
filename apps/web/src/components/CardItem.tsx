import type { Card as CardType } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  FileText,
  Image,
  Video,
  Music,
  ExternalLink,
  Trash2,
} from "lucide-react";
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
import { Badge } from "./ui/badge";

interface CardItemProps {
  card: CardType;
  onDelete?: () => void;
}

const getCardIcon = (type: CardType["type"]) => {
  switch (type) {
    case "text":
      return <FileText className="size-4 shrink-0" />;
    case "image":
      return <Image className="size-4 shrink-0" />;
    case "video":
      return <Video className="size-4 shrink-0" />;
    case "audio":
      return <Music className="size-4 shrink-0" />;
    case "url":
      return <ExternalLink className="size-4 shrink-0" />;
    default:
      return <FileText className="size-4 shrink-0" />;
  }
};

const getCardTitle = (card: CardType): string => {
  const { data } = card;
  return (
    data.title ||
    data.name ||
    data.url ||
    `${card.type.charAt(0).toUpperCase() + card.type.slice(1)} Card`
  );
};

const getCardContent = (card: CardType): string => {
  const { data } = card;

  switch (card.type) {
    case "text":
      return data.content || "";
    case "audio":
    case "video":
      return data.transcription || data.description || "";
    case "url":
      return data.description || data.url || "";
    case "image":
      return data.description || data.alt_text || "";
    default:
      return JSON.stringify(data);
  }
};

export function CardItem({ card, onDelete }: CardItemProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const title = getCardTitle(card);
  const content = getCardContent(card);

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

  return (
    <ContextMenu>
      <ContextMenuTrigger className="h-full">
        <Card className="h-full relative">
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            {content && <CardDescription>{content && content}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Render type-specific content */}
            {card.type === "url" && card.data.url && (
              <a
                href={card.data.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
                onClick={(e) => e.stopPropagation()}
              >
                {card.data.url}
              </a>
            )}

            {card.type === "image" && card.data.media_url && (
              <div className="aspect-video bg-muted rounded overflow-hidden">
                <img
                  src={card.data.media_url}
                  alt={card.data.alt_text || title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            )}

            {(card.type === "audio" || card.type === "video") &&
              card.data.duration && (
                <div className="text-muted-foreground">
                  Duration: {Math.floor(card.data.duration / 60)}:
                  {(card.data.duration % 60).toString().padStart(2, "0")}
                </div>
              )}
            <Badge
              variant="outline"
              className="absolute bottom-2 right-2 rounded-full border-dashed"
            >
              {getCardIcon(card.type)}
              {card.type}
            </Badge>
          </CardContent>
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
