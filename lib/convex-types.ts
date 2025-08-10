import { Doc, Id } from "../convex/_generated/dataModel";
import { cardTypes, cardTypeValidator, metadataValidator } from "../convex/schema";
import { Infer } from "convex/values";

// === Core Data Types (Generated from Schema) ===

/**
 * Card document type - automatically generated from Convex schema
 */
export type CardData = Doc<"cards">;

/**
 * Card ID type - strongly typed Convex ID
 */
export type CardId = Id<"cards">;

/**
 * Storage file ID type
 */
export type StorageId = Id<"_storage">;

// === Derived Types from Validators ===

/**
 * Card type literal - derived from schema cardTypes array
 */
export type CardType = (typeof cardTypes)[number];

/**
 * Card metadata type - derived from metadataValidator
 */
export type CardMetadata = Infer<typeof metadataValidator>;

/**
 * Card type validator type - for function arguments
 */
export type CardTypeValidator = Infer<typeof cardTypeValidator>;

// === Utility Types ===

/**
 * Card creation input type - excludes auto-generated fields
 */
export type CreateCardInput = Omit<CardData, "_id" | "_creationTime" | "userId" | "createdAt" | "updatedAt">;

/**
 * Card update input type - all fields optional except ID
 */
export type UpdateCardInput = Partial<Pick<CardData, "title" | "content" | "url" | "tags" | "notes">>;

/**
 * Card with file URLs resolved - for UI display
 */
export type CardWithUrls = CardData & {
  fileUrl?: string;
  thumbnailUrl?: string;
};

// === Filter and Search Types ===

/**
 * Card filter options
 */
export type CardFilterOptions = {
  type?: CardType;
  favoritesOnly?: boolean;
  deletedOnly?: boolean;
  tags?: string[];
  limit?: number;
};

/**
 * Card search parameters
 */
export type CardSearchParams = {
  query?: string;
  type?: CardType | "favorites" | "trash";
  tags?: string[];
};

// === Constants Derived from Schema ===

/**
 * All card types as readonly array
 */
export const CARD_TYPES = [...cardTypes] as readonly CardType[];

/**
 * Card type labels for UI display
 */
export const CARD_TYPE_LABELS: Record<CardType, string> = {
  text: "Text",
  link: "Links", 
  image: "Images",
  video: "Videos",
  audio: "Audio",
  document: "Documents",
} as const;

/**
 * Card type icons mapping (for UI components)
 */
export const CARD_TYPE_ICONS: Record<CardType, string> = {
  text: "FileText",
  link: "Link", 
  image: "Image",
  video: "Video",
  audio: "Volume2",
  document: "File",
} as const;

// === Validation Helpers ===

/**
 * Type guard to check if a value is a valid CardType
 */
export function isCardType(value: unknown): value is CardType {
  return typeof value === "string" && cardTypes.includes(value as CardType);
}

/**
 * Type guard to check if a card is deleted
 */
export function isCardDeleted(card: CardData): boolean {
  return Boolean(card.isDeleted);
}

/**
 * Type guard to check if a card is favorited
 */
export function isCardFavorited(card: CardData): boolean {
  return Boolean(card.isFavorited);
}

// === Metadata Helpers ===

/**
 * Extract link metadata from CardMetadata
 */
export type LinkMetadata = Pick<NonNullable<CardMetadata>, "linkTitle" | "linkDescription" | "linkImage" | "linkFavicon">;

/**
 * Extract file metadata from CardMetadata  
 */
export type FileMetadata = Pick<NonNullable<CardMetadata>, "fileSize" | "fileName" | "mimeType">;

/**
 * Extract media metadata from CardMetadata
 */
export type MediaMetadata = Pick<NonNullable<CardMetadata>, "duration" | "width" | "height">;

// === UI-Specific Types ===

/**
 * Typeahead option for search/filter dropdowns
 */
export interface TypeaheadOption {
  value: CardType | "favorites" | "trash";
  label: string;
}

/**
 * Reserved keywords for search functionality
 */
export const RESERVED_KEYWORDS: TypeaheadOption[] = [
  { value: "text", label: "Text" },
  { value: "link", label: "Links" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
  { value: "audio", label: "Audio" },
  { value: "document", label: "Documents" },
  { value: "favorites", label: "Favorites" },
  { value: "trash", label: "Trash" },
] as const;