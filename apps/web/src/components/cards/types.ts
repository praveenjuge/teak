import type { CardActionId } from "../../lib/cardActions";
import type { ClientCard } from "../../lib/cardTypes";

type FileMetadata = NonNullable<ClientCard["fileMetadata"]>;

export type LinkPreviewMetadata = NonNullable<
  NonNullable<ClientCard["metadata"]>["linkPreview"]
>;
export type ScrubMetadata = NonNullable<FileMetadata["scrub"]>;
export type WaveformMetadata = NonNullable<FileMetadata["waveform"]>;

/**
 * A card as a grid, the pinned row or Revisit shows it: what the server
 * sends (`ClientCard`), any of which an optimistic card may not have yet.
 */
export type CardWithUrls = Omit<Partial<ClientCard>, "_id"> & { _id: string };

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
  card: CardWithUrls;
  isPriority?: boolean;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  isTabStop?: boolean;
  /** False where the card moves another way (the pinned row's drag). */
  nativeDrag?: boolean;
  onAction?: (action: CardActionId, card: CardWithUrls) => void;
  onClick?: (card: CardWithUrls, origin?: CardOpenOrigin) => void;
  onEditFolders?: (cardId: string) => void;
  onEditLink?: (cardId: string) => void;
  onRemoveFromFolder?: (cardId: string) => void;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isOptimisticCard(cardId: string): boolean {
  return UUID_REGEX.test(cardId);
}
