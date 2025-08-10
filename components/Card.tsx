import { ExternalLink, Heart, Trash2 } from "lucide-react";
import {
  AudioCard,
  DocumentCard,
  ImageCard,
  LinkCard,
  TextCard,
  VideoCard,
} from "./CardTypes";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Card as UICard,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { type CardData } from "@/lib/types";


interface CardProps {
  card: CardData;
  onClick?: (card: CardData) => void;
  onDelete?: (cardId: string) => void;
  onToggleFavorite?: (cardId: string) => void;
}

export function Card({ card, onClick, onDelete, onToggleFavorite }: CardProps) {
  const handleClick = () => {
    onClick?.(card);
  };

  const handleDelete = () => {
    onDelete?.(card._id);
  };

  const handleToggleFavorite = () => {
    onToggleFavorite?.(card._id);
  };

  const openLink = () => {
    if (card.url) {
      window.open(card.url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <UICard
          className="hover:shadow-md transition-shadow cursor-pointer p-3 relative"
          onClick={handleClick}
        >
          {card.isFavorited && (
            <div className="absolute top-2 right-2 z-10">
              <Heart className="h-4 w-4 fill-red-500 text-red-500" />
            </div>
          )}

          {card.title && (
            <CardHeader className="p-0 pb-2">
              <CardTitle className="truncate text-base pr-6">
                {card.title}
              </CardTitle>
            </CardHeader>
          )}

          <CardContent className="p-0 space-y-2">
            {card.type === "text" && <TextCard card={card} />}
            {card.type === "link" && <LinkCard card={card} preview={true} />}
            {card.type === "image" && <ImageCard card={card} />}
            {card.type === "video" && <VideoCard card={card} />}
            {card.type === "audio" && <AudioCard card={card} preview={true} />}
            {card.type === "document" && (
              <DocumentCard card={card} preview={true} />
            )}

            {card.description && (
              <p className="text-muted-foreground text-xs">
                {card.description}
              </p>
            )}
          </CardContent>
        </UICard>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-48">
        {card.url && (
          <>
            <ContextMenuItem onClick={openLink}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Open Link
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onClick={handleToggleFavorite}>
          <Heart
            className={`mr-2 h-4 w-4 ${
              card.isFavorited ? "fill-red-500 text-red-500" : ""
            }`}
          />
          {card.isFavorited ? "Remove from Favorites" : "Add to Favorites"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={handleDelete}
          className="text-red-600 focus:text-red-600"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
