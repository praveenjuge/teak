import { cardTypes } from "../convex/schema";

// === Derived Constants from Schema ===

export type CardType = (typeof cardTypes)[number];

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

// === Validation Helpers ===

/**
 * Type guard to check if a value is a valid CardType
 */
export function isCardType(value: unknown): value is CardType {
  return typeof value === "string" && cardTypes.includes(value as CardType);
}