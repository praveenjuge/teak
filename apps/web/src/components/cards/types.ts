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

export interface ScrubMetadata {
  frameHeight: number;
  frames: number;
  frameWidth: number;
}

export interface WaveformMetadata {
  detail: number[];
  grid: number[];
}

export interface CardWithUrls {
  _id: string;
  aiSummary?: string;
  colors?: Array<{ hex: string }>;
  compactUrl?: string;
  completedAt?: number;
  content?: string;
  detailUrl?: string;
  fileKey?: string;
  fileMetadata?: {
    duration?: number;
    fileName?: string;
    height?: number;
    width?: number;
    mimeType?: string;
    scrub?: ScrubMetadata;
    waveform?: WaveformMetadata;
  };
  fileUrl?: string;
  hasThumbnailOverride?: true;
  isArchived?: boolean;
  isDeleted?: boolean;
  isFavorited?: boolean;
  linkPreviewImageUrl?: string;
  linkPreviewMedia?: LinkPreviewMedia[];
  metadata?: {
    linkPreview?: LinkPreviewMetadata & Record<string, unknown>;
    linkCategory?: {
      category?: string;
      facts?: Array<{ label: string; value: string }>;
      price?: { amount: number; currency?: string };
    };
  };
  metadataDescription?: string;
  metadataTitle?: string;
  metadataTitleEdited?: boolean;
  /** A link's archived copy of its page. */
  pageArchive?: {
    capturedAt: number;
    kind: "full" | "text_only";
    storageKey: string;
  };
  placeholderUrl?: string;
  processingStatus?: Partial<
    Record<
      string,
      { status: "completed" | "failed" | "in_progress" | "pending" }
    >
  >;
  screenshotUrl?: string;
  scrubKey?: string;
  scrubUrl?: string;
  sourceUrl?: string;
  thumbnailKey?: string;
  thumbnailOverride?: { height: number; storageKey: string; width: number };
  thumbnailUrl?: string;
  type?: string;
  url?: string;
}

export interface CardProps {
  card: CardWithUrls & Record<string, unknown>;
  isPriority?: boolean;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  isTabStop?: boolean;
  isTrashMode?: boolean;
  onAddTags?: (cardId: string) => void;
  onClick?: (card: CardWithUrls & Record<string, unknown>) => void;
  onCopyImage?: (content: string, isImage: boolean) => void;
  onDelete?: (cardId: string) => void;
  onEditFolders?: (cardId: string) => void;
  onEditLink?: (cardId: string) => void;
  onEnterSelectionMode?: (cardId: string) => void;
  onPermanentDelete?: (cardId: string) => void;
  onRestore?: (cardId: string) => void;
  onToggleArchive?: (cardId: string, archive: boolean) => void;
  onToggleFavorite?: (cardId: string) => void;
  onToggleSelection?: (cardId: string) => void;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isOptimisticCard(cardId: string): boolean {
  return UUID_REGEX.test(cardId);
}
