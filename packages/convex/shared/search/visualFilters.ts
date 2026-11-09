import { isColorCardType, isVisualStyleCardType } from "../constants";
import type { Doc } from "../types";

export interface VisualFilters {
  hexFilters?: readonly string[];
  hueFilters?: readonly string[];
  styleFilters?: readonly string[];
}

type VisualCard = Pick<
  Doc<"cards">,
  "colorHexes" | "colorHues" | "type" | "visualStyles"
>;

const holdsAny = (
  values: readonly string[] | undefined,
  wanted: readonly string[]
) => {
  const held = new Set(values ?? []);
  return wanted.some((value) => held.has(value));
};

/**
 * Whether a card matches the style, hue and hex filters (normalized first):
 * any one value within each filter given, and every filter given. Only
 * visual-style cards carry styles and only color cards carry hues and hexes.
 */
export const matchesVisualFilters = (
  card: VisualCard,
  { styleFilters, hueFilters, hexFilters }: VisualFilters
): boolean => {
  if (
    styleFilters?.length &&
    !(
      isVisualStyleCardType(card.type) &&
      holdsAny(card.visualStyles, styleFilters)
    )
  ) {
    return false;
  }
  if (
    hueFilters?.length &&
    !(isColorCardType(card.type) && holdsAny(card.colorHues, hueFilters))
  ) {
    return false;
  }
  return !(
    hexFilters?.length &&
    !(isColorCardType(card.type) && holdsAny(card.colorHexes, hexFilters))
  );
};
