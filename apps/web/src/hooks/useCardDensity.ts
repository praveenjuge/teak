import { useCallback } from "react";
import {
  CARD_GRID_LAYOUTS,
  type CardDensity,
  type CardGridLayout,
  COMPACT_GRID_STORAGE_KEY,
} from "../lib/cardDensity";
import { useStoredFlag } from "./useStoredFlag";

/**
 * The grid's density from the View menu, kept in this browser so it stays
 * through reloads; blocked storage keeps it for the visit only.
 */
export function useCardDensity(): {
  density: CardDensity;
  layout: CardGridLayout;
  setDensity: (density: CardDensity) => void;
} {
  const [compact, setCompact] = useStoredFlag(COMPACT_GRID_STORAGE_KEY);
  const density: CardDensity = compact ? "compact" : "comfortable";
  const setDensity = useCallback(
    (next: CardDensity) => setCompact(next === "compact"),
    [setCompact]
  );
  return { density, layout: CARD_GRID_LAYOUTS[density], setDensity };
}
