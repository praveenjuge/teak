export const CARD_DENSITIES = ["comfortable", "compact"] as const;
export type CardDensity = (typeof CARD_DENSITIES)[number];

/** Saved per browser: a viewer's own taste, not the account's. */
export const COMPACT_GRID_STORAGE_KEY = "teak.compactGrid";

export interface CardGridLayout {
  gutter: number;
  maxColumns: number;
  minColumnWidth: number;
}

/**
 * Compact puts more, narrower columns closer together, so a wide screen
 * shows up to seven cards across instead of five.
 */
export const CARD_GRID_LAYOUTS: Record<CardDensity, CardGridLayout> = {
  comfortable: { gutter: 24, maxColumns: 5, minColumnWidth: 200 },
  compact: { gutter: 12, maxColumns: 7, minColumnWidth: 150 },
};

export const isCardDensity = (value: unknown): value is CardDensity =>
  (CARD_DENSITIES as readonly unknown[]).includes(value);
