import type { Doc } from "@teak/convex/_generated/dataModel";
import {
  MAX_PALETTE_COLORS,
  normalizeHexColor,
} from "@teak/convex/shared/utils/colorUtils";

export type PaletteField = "addColor" | "removeColor";

/** A palette's colors once one is added or removed, as the server does it. */
export const editPaletteColors = (
  colors: Doc<"cards">["colors"],
  field: PaletteField,
  hex: string
): NonNullable<Doc<"cards">["colors"]> => {
  const current = colors ?? [];
  const key = normalizeHexColor(hex);
  const isSame = (color: { hex: string }) =>
    normalizeHexColor(color.hex) === key;
  if (field === "removeColor") {
    return current.filter((color) => !isSame(color));
  }
  return current.some(isSame) ? current : [...current, { hex }];
};

const distinctHexes = (colors: Doc<"cards">["colors"]) =>
  new Set(
    (colors ?? []).map((color) => normalizeHexColor(color.hex) ?? color.hex)
  );

/** Whether a palette has `hex` (a normalized `#RRGGBB`) already. */
export const paletteHasColor = (
  colors: Doc<"cards">["colors"],
  hex: string
): boolean => distinctHexes(colors).has(hex);

/** What the card dialog lets someone do to a palette's colors. */
export const paletteEditing = (
  card: Pick<Doc<"cards">, "colors" | "isDeleted" | "type">
): { canAdd: boolean; canRemove: boolean } => {
  const editable = card.type === "palette" && !card.isDeleted;
  return {
    canAdd: editable && (card.colors?.length ?? 0) < MAX_PALETTE_COLORS,
    canRemove: editable && distinctHexes(card.colors).size > 1,
  };
};
