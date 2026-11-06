import type { CardActionId } from "../../lib/cardActions";

export type { PinTarget } from "../../lib/pinnedCards";

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

/** Where a card was on screen when it was opened, in viewport pixels. */
export interface CardOpenOrigin {
  x: number;
  y: number;
}

export interface CardProps {
  /**
   * The card actions this surface offers, every grid action unless it says
   * otherwise. Each shows in the card's menu when the card can take it.
   */
  actions?: ReadonlySet<CardActionId>;
  card: CardWithUrls & Record<string, unknown>;
  isPriority?: boolean;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  isTabStop?: boolean;
  /** False where the card moves another way (the pinned row's drag). */
  nativeDrag?: boolean;
  onAction?: (
    action: CardActionId,
    card: CardWithUrls & Record<string, unknown>
  ) => void;
  onClick?: (
    card: CardWithUrls & Record<string, unknown>,
    origin?: CardOpenOrigin
  ) => void;
  onCopyImage?: (content: string | Promise<string>, isImage: boolean) => void;
  onEditFolders?: (cardId: string) => void;
  onEditLink?: (cardId: string) => void;
  onRemoveFromFolder?: (cardId: string) => void;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isOptimisticCard(cardId: string): boolean {
  return UUID_REGEX.test(cardId);
}

/** Whether there are cards and every one is a favorite. */
export const allFavorited = (cards: readonly { isFavorited?: boolean }[]) =>
  cards.length > 0 && cards.every((card) => card.isFavorited === true);
