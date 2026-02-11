// === Card Types ===
// NOTE: Keep in sync with convex/schema.ts
export const cardTypes = [
  "text",
  "link",
  "image",
  "video",
  "audio",
  "document",
  "palette",
  "quote",
] as const;

// === Derived Constants from Schema ===

export type CardType = (typeof cardTypes)[number];

// === Visual Style + Color Facet Vocabulary ===

export const VISUAL_STYLE_TAXONOMY = [
  "abstract",
  "cinematic",
  "dark",
  "illustrative",
  "minimal",
  "monochrome",
  "moody",
  "pastel",
  "photographic",
  "retro",
  "surreal",
  "vintage",
  "vibrant",
] as const;

export type VisualStyle = (typeof VISUAL_STYLE_TAXONOMY)[number];

export const VISUAL_STYLE_LABELS: Record<VisualStyle, string> = {
  abstract: "Abstract",
  cinematic: "Cinematic",
  dark: "Dark",
  illustrative: "Illustrative",
  minimal: "Minimal",
  monochrome: "Monochrome",
  moody: "Moody",
  pastel: "Pastel",
  photographic: "Photographic",
  retro: "Retro",
  surreal: "Surreal",
  vintage: "Vintage",
  vibrant: "Vibrant",
} as const;

const VISUAL_STYLE_ALIAS_MAP: Record<string, VisualStyle> = {
  abstract: "abstract",
  abstraction: "abstract",
  artsy: "abstract",
  cinematic: "cinematic",
  cinema: "cinematic",
  filmic: "cinematic",
  movie: "cinematic",
  dark: "dark",
  darkmode: "dark",
  lowkey: "dark",
  illustration: "illustrative",
  illustrated: "illustrative",
  illustrative: "illustrative",
  drawing: "illustrative",
  sketch: "illustrative",
  cartoon: "illustrative",
  minimal: "minimal",
  minimalist: "minimal",
  monochrome: "monochrome",
  grayscale: "monochrome",
  greyscale: "monochrome",
  blackandwhite: "monochrome",
  blackwhite: "monochrome",
  bw: "monochrome",
  moody: "moody",
  dramatic: "moody",
  atmospheric: "moody",
  pastel: "pastel",
  soft: "pastel",
  photo: "photographic",
  photograph: "photographic",
  photography: "photographic",
  photographic: "photographic",
  realistic: "photographic",
  retro: "retro",
  synthwave: "retro",
  surreal: "surreal",
  dreamlike: "surreal",
  vintage: "vintage",
  antique: "vintage",
  vibrant: "vibrant",
  colorful: "vibrant",
  colourful: "vibrant",
  saturated: "vibrant",
} as const;

const normalizeFacetToken = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-");

export function normalizeVisualStyle(value: string): VisualStyle | null {
  const normalized = normalizeFacetToken(value);
  if (!normalized) {
    return null;
  }

  if ((VISUAL_STYLE_TAXONOMY as readonly string[]).includes(normalized)) {
    return normalized as VisualStyle;
  }

  const aliasKey = normalized.replace(/-/g, "");
  return VISUAL_STYLE_ALIAS_MAP[aliasKey] ?? null;
}

export function normalizeVisualStyleFilters(values?: string[]): VisualStyle[] {
  if (!values?.length) {
    return [];
  }

  const seen = new Set<VisualStyle>();
  const normalized: VisualStyle[] = [];

  for (const value of values) {
    const style = normalizeVisualStyle(value);
    if (!style || seen.has(style)) {
      continue;
    }
    seen.add(style);
    normalized.push(style);
  }

  return normalized;
}

export function extractVisualStylesFromTags(
  tags?: string[]
): VisualStyle[] | undefined {
  const normalized = normalizeVisualStyleFilters(tags);
  return normalized.length > 0 ? normalized : undefined;
}

export const COLOR_HUE_BUCKETS = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "cyan",
  "blue",
  "purple",
  "pink",
  "brown",
  "neutral",
] as const;

export type ColorHueBucket = (typeof COLOR_HUE_BUCKETS)[number];

export const COLOR_HUE_LABELS: Record<ColorHueBucket, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  teal: "Teal",
  cyan: "Cyan",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
  brown: "Brown",
  neutral: "Neutral",
} as const;

const COLOR_HUE_ALIAS_MAP: Record<string, ColorHueBucket> = {
  red: "red",
  orange: "orange",
  yellow: "yellow",
  green: "green",
  teal: "teal",
  cyan: "cyan",
  blue: "blue",
  purple: "purple",
  violet: "purple",
  indigo: "purple",
  pink: "pink",
  magenta: "pink",
  fuchsia: "pink",
  brown: "brown",
  neutral: "neutral",
  gray: "neutral",
  grey: "neutral",
  monochrome: "neutral",
} as const;

export function normalizeColorHueBucket(value: string): ColorHueBucket | null {
  const normalized = normalizeFacetToken(value).replace(/-/g, "");
  if (!normalized) {
    return null;
  }
  return COLOR_HUE_ALIAS_MAP[normalized] ?? null;
}

export function normalizeHueFilters(values?: string[]): ColorHueBucket[] {
  if (!values?.length) {
    return [];
  }

  const seen = new Set<ColorHueBucket>();
  const normalized: ColorHueBucket[] = [];

  for (const value of values) {
    const hue = normalizeColorHueBucket(value);
    if (!hue || seen.has(hue)) {
      continue;
    }
    seen.add(hue);
    normalized.push(hue);
  }

  return normalized;
}

// === App Configuration Constants ===

/**
 * Maximum number of cards allowed for free tier users
 */
export const FREE_TIER_LIMIT = 200;

/**
 * Maximum file size for uploads (20MB in bytes)
 */
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

/**
 * Maximum number of files that can be uploaded at once
 */
export const MAX_FILES_PER_UPLOAD = 5;

// === Error Codes & Messages ===

export const CARD_ERROR_CODES = {
  CARD_LIMIT_REACHED: "CARD_LIMIT_REACHED",
  RATE_LIMITED: "RATE_LIMITED",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  TOO_MANY_FILES: "TOO_MANY_FILES",
  UNSUPPORTED_TYPE: "UNSUPPORTED_TYPE",
  TYPE_MISMATCH: "TYPE_MISMATCH",
} as const;

export type CardErrorCode =
  (typeof CARD_ERROR_CODES)[keyof typeof CARD_ERROR_CODES];

export const CARD_ERROR_MESSAGES: Record<CardErrorCode, string> = {
  CARD_LIMIT_REACHED:
    "Card limit reached. Please upgrade to Pro for unlimited cards.",
  RATE_LIMITED: "Too many cards created. Please wait a moment and try again.",
  FILE_TOO_LARGE: "File is too large. Maximum file size is 20MB.",
  TOO_MANY_FILES:
    "Too many files selected. You can upload up to 5 files at a time.",
  UNSUPPORTED_TYPE:
    "Unsupported file type. Please upload an image, video, audio, or document.",
  TYPE_MISMATCH: "Uploaded file does not match the selected type.",
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
  ...cardTypes.map(
    (cardType): TypeaheadOption => ({
      value: cardType,
      label: CARD_TYPE_REGISTRY[cardType].searchLabel,
    })
  ),
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
