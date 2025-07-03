import type { Card as CardType } from "@/lib/api";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FileText, Image, Video, Music, ExternalLink } from "lucide-react";

interface CardItemProps {
  card: CardType;
}

const getCardIcon = (type: CardType["type"]) => {
  switch (type) {
    case "text":
      return <FileText className="size-5" />;
    case "image":
      return <Image className="size-5" />;
    case "video":
      return <Video className="size-5" />;
    case "audio":
      return <Music className="size-5" />;
    case "url":
      return <ExternalLink className="size-5" />;
    default:
      return <FileText className="size-5" />;
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

export function CardItem({ card }: CardItemProps) {
  const title = getCardTitle(card);
  const content = getCardContent(card);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            {getCardIcon(card.type)}
            <h3 className="font-semibold text-sm line-clamp-1">{title}</h3>
          </div>
          <span className="text-xs text-muted-foreground capitalize bg-muted px-2 py-1 rounded">
            {card.type}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {content && (
          <p className="text-sm text-muted-foreground line-clamp-3">
            {content}
          </p>
        )}

        {/* Render type-specific content */}
        {card.type === "url" && card.data.url && (
          <a
            href={card.data.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:text-blue-800 break-all"
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
            <div className="text-xs text-muted-foreground">
              Duration: {Math.floor(card.data.duration / 60)}:
              {(card.data.duration % 60).toString().padStart(2, "0")}
            </div>
          )}
      </CardContent>
    </Card>
  );
}
