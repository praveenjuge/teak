import {
  Trash2,
  ExternalLink,
} from "lucide-react";
import { TextCard, LinkCard, ImageCard, VideoCard, AudioCard, DocumentCard } from "./CardTypes";
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

export type CardType = "text" | "link" | "image" | "video" | "audio" | "document";

export interface CardData {
  _id: string;
  userId: string;
  title?: string;
  content: string;
  type: CardType;
  url?: string;
  fileId?: string;
  thumbnailId?: string;
  tags?: string[];
  description?: string;
  metadata?: {
    linkTitle?: string;
    linkDescription?: string;
    linkImage?: string;
    linkFavicon?: string;
    fileSize?: number;
    fileName?: string;
    mimeType?: string;
    duration?: number;
  };
  createdAt: number;
  updatedAt: number;
}

interface CardProps {
  card: CardData;
  onClick?: (card: CardData) => void;
  onDelete?: (cardId: string) => void;
}

export function Card({ card, onClick, onDelete }: CardProps) {
  const handleClick = () => {
    onClick?.(card);
  };

  const handleDelete = () => {
    onDelete?.(card._id);
  };

  const openLink = () => {
    if (card.url) {
      window.open(card.url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <UICard 
          className="hover:shadow-md transition-shadow cursor-pointer p-3" 
          onClick={handleClick}
        >
          {card.title && (
            <CardHeader className="p-0 pb-2">
              <CardTitle className="truncate text-base">{card.title}</CardTitle>
            </CardHeader>
          )}

          <CardContent className="p-0 space-y-2">
            {card.type === "text" && <TextCard card={card} />}
            {card.type === "link" && <LinkCard card={card} preview={true} />}
            {card.type === "image" && <ImageCard card={card} />}
            {card.type === "video" && <VideoCard card={card} />}
            {card.type === "audio" && <AudioCard card={card} preview={true} />}
            {card.type === "document" && <DocumentCard card={card} preview={true} />}
            
            {card.description && (
              <p className="text-muted-foreground text-xs">{card.description}</p>
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
        <ContextMenuItem onClick={handleDelete} className="text-red-600 focus:text-red-600">
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}