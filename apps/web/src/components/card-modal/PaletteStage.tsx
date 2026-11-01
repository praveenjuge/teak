import type { Doc } from "@teak/convex/_generated/dataModel";
import { paletteEditing } from "@/hooks/paletteColors";
import type { PaletteColorsControl } from "@/hooks/usePaletteColors";
import { PalettePreview } from "../card-previews/PalettePreview";

export function PaletteStage({
  card,
  colors,
}: {
  card: Doc<"cards">;
  colors?: PaletteColorsControl;
}) {
  const { canAdd, canEdit, canRemove } = paletteEditing(card);
  return (
    <PalettePreview
      card={card}
      isFull={!canAdd}
      onAddColor={colors && canEdit ? colors.addColor : undefined}
      onRemoveColor={
        colors && canRemove ? (hex) => void colors.removeColor(hex) : undefined
      }
    />
  );
}
