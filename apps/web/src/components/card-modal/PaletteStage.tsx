import type { Doc } from "@teak/convex/_generated/dataModel";
import { paletteEditing } from "@/hooks/paletteColors";
import { usePaletteColors } from "@/hooks/usePaletteColors";
import { PalettePreview } from "../card-previews/PalettePreview";

/** A palette in the card dialog, where its colors can be added and removed. */
export function PaletteStage({ card }: { card: Doc<"cards"> }) {
  const { addColor, removeColor } = usePaletteColors(card._id);
  const { canAdd, canRemove } = paletteEditing(card);
  return (
    <PalettePreview
      card={card}
      onAddColor={canAdd ? addColor : undefined}
      onRemoveColor={canRemove ? (hex) => void removeColor(hex) : undefined}
    />
  );
}
