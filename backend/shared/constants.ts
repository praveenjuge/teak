// === Card Types ===
// NOTE: Keep in sync with backend/convex/schema.ts
export const cardTypes = ["text", "link", "image", "video", "audio", "document", "palette", "quote"] as const;

// === Derived Constants from Schema ===

export type CardType = (typeof cardTypes)[number];

// === App Configuration Constants ===

/**
 * Maximum number of cards allowed for free tier users
 */
export const FREE_TIER_LIMIT = 25;

// === Error Codes & Messages ===

export const CARD_ERROR_CODES = {
  CARD_LIMIT_REACHED: "CARD_LIMIT_REACHED",
} as const;

export type CardErrorCode =
  (typeof CARD_ERROR_CODES)[keyof typeof CARD_ERROR_CODES];

export const CARD_ERROR_MESSAGES: Record<CardErrorCode, string> = {
  CARD_LIMIT_REACHED:
    "Card limit reached. Please upgrade to Pro for unlimited cards.",
} as const;

/**
 * All card types as readonly array
 */
export const CARD_TYPES = [...cardTypes] as readonly CardType[];

/**
 * Card type labels for UI display
 */
export const CARD_TYPE_LABELS: Record<CardType, string> = {
  text: "Text",
  link: "Link",
  image: "Image",
  video: "Video",
  audio: "Audio",
  document: "Document",
  palette: "Palette",
  quote: "Quote",
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
  palette: "Palette",
  quote: "Quote",
} as const;

/**
 * Card type configuration registry for centralized management
 */
export interface CardTypeConfig {
  label: string;
  icon: string;
  searchLabel: string;
}

export const CARD_TYPE_REGISTRY: Record<CardType, CardTypeConfig> = {
  text: {
    label: "Text",
    icon: "FileText",
    searchLabel: "Text",
  },
  link: {
    label: "Link",
    icon: "Link",
    searchLabel: "Links",
  },
  image: {
    label: "Image",
    icon: "Image",
    searchLabel: "Images",
  },
  video: {
    label: "Video",
    icon: "Video",
    searchLabel: "Videos",
  },
  audio: {
    label: "Audio",
    icon: "Volume2",
    searchLabel: "Audio",
  },
  document: {
    label: "Document",
    icon: "File",
    searchLabel: "Documents",
  },
  palette: {
    label: "Palette",
    icon: "Palette",
    searchLabel: "Palettes",
  },
  quote: {
    label: "Quote",
    icon: "Quote",
    searchLabel: "Quotes",
  },
} as const;

/**
 * Helper functions for card type configuration
 */
export function getCardTypeConfig(cardType: CardType): CardTypeConfig {
  return CARD_TYPE_REGISTRY[cardType];
}

export function getCardTypeIcon(cardType: CardType): string {
  return CARD_TYPE_REGISTRY[cardType].icon;
}

export function getCardTypeLabel(cardType: CardType): string {
  return CARD_TYPE_REGISTRY[cardType].label;
}

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
  ...cardTypes.map((cardType): TypeaheadOption => ({
    value: cardType,
    label: CARD_TYPE_REGISTRY[cardType].searchLabel,
  })),
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
