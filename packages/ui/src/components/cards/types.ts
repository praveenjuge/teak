export interface LinkPreviewMetadata {
  description?: string;
  faviconUrl?: string;
  imageHeight?: number;
  imageUrl?: string;
  imageWidth?: number;
  screenshotHeight?: number;
  screenshotWidth?: number;
  status?: string;
  title?: string;
}

export interface LinkPreviewMedia {
  contentType?: string;
  height?: number;
  posterContentType?: string;
  posterHeight?: number;
  posterUrl?: string;
  posterWidth?: number;
  type: "image" | "video";
  url: string;
  width?: number;
}

export interface CardWithUrls {
  _id: string;
  colors?: Array<{ hex: string }>;
  content?: string;
  fileMetadata?: {
    fileName?: string;
    height?: number;
    width?: number;
    mimeType?: string;
  };
  fileUrl?: string;
  isDeleted?: boolean;
  isFavorited?: boolean;
  linkPreviewImageUrl?: string;
  linkPreviewMedia?: LinkPreviewMedia[];
  metadata?: {
    linkPreview?: LinkPreviewMetadata & Record<string, unknown>;
    linkCategory?: {
      facts?: Array<{ label: string; value: string }>;
    };
  };
  metadataDescription?: string;
  metadataTitle?: string;
  screenshotUrl?: string;
  thumbnailUrl?: string;
  type?: string;
  url?: string;
}

export interface CardProps {
  card: CardWithUrls & Record<string, unknown>;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  isTrashMode?: boolean;
  onAddTags?: (cardId: string) => void;
  onClick?: (card: CardWithUrls & Record<string, unknown>) => void;
  onCopyImage?: (content: string, isImage: boolean) => void;
  onDelete?: (cardId: string) => void;
  onEnterSelectionMode?: (cardId: string) => void;
  onPermanentDelete?: (cardId: string) => void;
  onRestore?: (cardId: string) => void;
  onToggleFavorite?: (cardId: string) => void;
  onToggleSelection?: () => void;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isOptimisticCard(cardId: string): boolean {
  return UUID_REGEX.test(cardId);
}
