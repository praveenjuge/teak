export type LinkPreviewMetadata = {
  status?: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  faviconUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  screenshotWidth?: number;
  screenshotHeight?: number;
};

export type CardWithUrls = {
  _id: string;
  type?: string;
  content?: string;
  url?: string;
  isDeleted?: boolean;
  isFavorited?: boolean;
  colors?: Array<{ hex: string }>;
  metadata?: {
    linkPreview?: LinkPreviewMetadata & Record<string, unknown>;
    linkCategory?: {
      facts?: Array<{ label: string; value: string }>;
    };
  };
  metadataTitle?: string;
  metadataDescription?: string;
  fileMetadata?: {
    fileName?: string;
    height?: number;
    width?: number;
    mimeType?: string;
  };
  fileUrl?: string;
  thumbnailUrl?: string;
  screenshotUrl?: string;
  linkPreviewImageUrl?: string;
};

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
