import type { Doc } from "@teak/convex/_generated/dataModel";
import { paletteEditing } from "@/hooks/paletteColors";
import type { PaletteColorsControl } from "@/hooks/usePaletteColors";
import { PalettePreview } from "../card-previews/PalettePreview";

/**
 * A palette in the card dialog. With `colors`, its colors can be added and
 * removed; without, it's read-only.
 */
export function PaletteStage({
  card,
  colors,
}: {
  card: Doc<"cards">;
  colors?: PaletteColorsControl;
}) {
  const { canAdd, canRemove } = paletteEditing(card);
  return (
    <PalettePreview
      card={card}
      onAddColor={colors && canAdd ? colors.addColor : undefined}
      onRemoveColor={
        colors && canRemove ? (hex) => void colors.removeColor(hex) : undefined
      }
    />
  );
}
