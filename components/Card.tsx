import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  MoreHorizontal,
  Edit,
  Trash2,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Video,
  Mic,
  Link as LinkIcon,
  File,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextCard, LinkCard, ImageCard, VideoCard, AudioCard, DocumentCard } from "./CardTypes";
import { cn } from "@/lib/utils";

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
  onEdit?: (card: CardData) => void;
  onDelete?: (cardId: string) => void;
}

const getCardIcon = (type: CardType) => {
  switch (type) {
    case "text":
      return <FileText className="w-4 h-4" />;
    case "link":
      return <LinkIcon className="w-4 h-4" />;
    case "image":
      return <ImageIcon className="w-4 h-4" />;
    case "video":
      return <Video className="w-4 h-4" />;
    case "audio":
      return <Mic className="w-4 h-4" />;
    case "document":
      return <File className="w-4 h-4" />;
    default:
      return <FileText className="w-4 h-4" />;
  }
};

const getCardTypeColor = (type: CardType) => {
  switch (type) {
    case "text":
      return "text-blue-600 bg-blue-50";
    case "link":
      return "text-green-600 bg-green-50";
    case "image":
      return "text-purple-600 bg-purple-50";
    case "video":
      return "text-red-600 bg-red-50";
    case "audio":
      return "text-orange-600 bg-orange-50";
    case "document":
      return "text-indigo-600 bg-indigo-50";
    default:
      return "text-gray-600 bg-gray-50";
  }
};

export function Card({ card, onEdit, onDelete }: CardProps) {
  const [showMenu, setShowMenu] = useState(false);

  const handleEdit = () => {
    setShowMenu(false);
    onEdit?.(card);
  };

  const handleDelete = () => {
    setShowMenu(false);
    onDelete?.(card._id);
  };

  const openLink = () => {
    if (card.url) {
      window.open(card.url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="relative bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={cn("p-1.5 rounded-md", getCardTypeColor(card.type))}>
            {getCardIcon(card.type)}
          </div>
          <div className="min-w-0 flex-1">
            {card.title && (
              <h3 className="font-medium text-gray-900 truncate">{card.title}</h3>
            )}
            <p className="text-xs text-gray-500 capitalize">
              {card.type} • {formatDistanceToNow(new Date(card.createdAt))} ago
            </p>
          </div>
        </div>
        
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setShowMenu(!showMenu)}
          >
            <MoreHorizontal className="w-4 h-4" />
          </Button>
          
          {showMenu && (
            <div className="absolute right-0 top-8 z-10 w-48 bg-white border border-gray-200 rounded-md shadow-lg">
              <div className="py-1">
                {card.url && (
                  <button
                    onClick={openLink}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Open Link
                  </button>
                )}
                <button
                  onClick={handleEdit}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Edit className="w-4 h-4" />
                  Edit
                </button>
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="space-y-2">
        {card.type === "text" && <TextCard card={card} />}
        {card.type === "link" && <LinkCard card={card} />}
        {card.type === "image" && <ImageCard card={card} />}
        {card.type === "video" && <VideoCard card={card} />}
        {card.type === "audio" && <AudioCard card={card} />}
        {card.type === "document" && <DocumentCard card={card} />}
        
        {card.description && (
          <p className="text-gray-500 text-xs">{card.description}</p>
        )}
      </div>

      {/* Tags */}
      {card.tags && card.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {card.tags.map((tag, index) => (
            <span
              key={index}
              className="inline-block bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded-full"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Click overlay for closing menu */}
      {showMenu && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setShowMenu(false)}
        />
      )}
    </div>
  );
}