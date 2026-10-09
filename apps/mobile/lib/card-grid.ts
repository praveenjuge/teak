import type { MobileCardSummary } from "./mobile-card-summary-cache";

/** Gap between tiles and columns; the screen edges get a little more. */
export const GRID_GAP = 12;
export const GRID_EDGE = 16;
export const TILE_RADIUS = 16;

const LINK_FALLBACK_RATIO = 1.91;
const MEDIA_FALLBACK_RATIO = 4 / 3;
const DOCUMENT_FALLBACK_RATIO = 3 / 4;
const FOOTER_HEIGHT = 44;

/** Two columns on phones, more as the window widens (iPad, Stage Manager). */
export const getGridColumnCount = (width: number): number => {
  if (width >= 1000) {
    return 4;
  }
  if (width >= 700) {
    return 3;
  }
  return 2;
};

export const getGridColumnWidth = (width: number, columns: number): number =>
  Math.floor((width - GRID_EDGE * 2 - GRID_GAP * (columns - 1)) / columns);

/** The tile's media URL, matching what the web grid shows for each type. */
export const getTileImageUrl = (
  card: MobileCardSummary
): string | undefined => {
  switch (card.type) {
    case "link":
      return card.linkPreviewImageUrl ?? card.screenshotUrl;
    case "image":
      return card.compactUrl ?? card.thumbnailUrl;
    case "video":
    case "document":
      return card.thumbnailUrl ?? card.compactUrl;
    default:
      return;
  }
};

/** Width / height for a tile's media, with the web's fallbacks. */
export const getTileImageRatio = (card: MobileCardSummary): number => {
  if (card.aspectRatio && card.aspectRatio > 0) {
    // Extreme panoramas or strips would make unusable tiles.
    return Math.min(Math.max(card.aspectRatio, 0.5), 2.5);
  }
  if (card.type === "link") {
    return LINK_FALLBACK_RATIO;
  }
  if (card.type === "document") {
    return DOCUMENT_FALLBACK_RATIO;
  }
  return MEDIA_FALLBACK_RATIO;
};

/** Approximate rendered height, used only to balance the columns. */
export const estimateTileHeight = (
  card: MobileCardSummary,
  columnWidth: number
): number => {
  const media = getTileImageUrl(card)
    ? columnWidth / getTileImageRatio(card)
    : 0;
  switch (card.type) {
    case "image":
    case "video":
      return media || columnWidth / MEDIA_FALLBACK_RATIO;
    case "link":
    case "document":
      return media + FOOTER_HEIGHT + (media ? 0 : 8);
    case "palette":
    case "audio":
      return 56;
    case "quote":
      return 84;
    default:
      return 72;
  }
};

/**
 * Masonry placement: each card goes to the currently shortest column, so the
 * columns stay balanced and the reading order runs left to right.
 */
export const distributeIntoColumns = <T>(
  items: T[],
  columns: number,
  estimate: (item: T) => number,
  gap = GRID_GAP
): T[][] => {
  const count = Math.max(1, columns);
  const result: T[][] = Array.from({ length: count }, () => []);
  const heights = new Array<number>(count).fill(0);
  for (const item of items) {
    let shortest = 0;
    for (let index = 1; index < count; index += 1) {
      if (heights[index] < heights[shortest]) {
        shortest = index;
      }
    }
    result[shortest].push(item);
    heights[shortest] += estimate(item) + gap;
  }
  return result;
};

export const WAVEFORM_BAR_COUNT = 45;

/**
 * Port of `getAudioWaveHeight` in packages/ui AudioWavePreview, so a
 * recording draws the same waveform on the web, Mac, and iPhone.
 * Returns fractions of the available height between 0.2 and 0.8.
 */
export const getWaveformHeights = (seed: string): number[] =>
  Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
    let hash = index;
    for (const char of seed) {
      // biome-ignore lint/suspicious/noBitwiseOperators: matches the web's 32-bit string hash
      const next = (hash << 5) - hash + char.charCodeAt(0);
      // biome-ignore lint/suspicious/noBitwiseOperators: keeps the hash in 32-bit range like the web
      hash = next & next;
    }
    return Math.abs(Math.sin(hash)) * 0.6 + 0.2;
  });
