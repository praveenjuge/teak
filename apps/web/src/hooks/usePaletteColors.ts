import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import {
  normalizeHexColor,
  paletteColorFromHex,
} from "@teak/convex/shared/utils/colorUtils";
import { useTranslations } from "@teak/i18n/react";
import { useMutation } from "convex/react";
import { useCallback } from "react";
import { toast } from "sonner";
import { UNDO_TOAST_DURATION_MS } from "../constants/toast";
import { updateCardInSearchQueries } from "../lib/cardQueryOptimisticUpdates";
import { editPaletteColors, type PaletteField } from "./paletteColors";

/** What the card dialog needs to change a palette's colors. */
export interface PaletteColorsControl {
  addColor: (hex: string) => Promise<boolean>;
  removeColor: (hex: string) => Promise<void>;
}

/** Adds and removes a palette card's colors, with Undo for a removal. */
export function usePaletteColors(
  cardId: Id<"cards"> | undefined
): PaletteColorsControl {
  const t = useTranslations("cardPreviews.palette");
  const tc = useTranslations("common");
  const updateCardField = useMutation(
    api.cards.updateCardField
  ).withOptimisticUpdate((localStore, args) => {
    const hex = typeof args.value === "string" ? args.value : "";
    if (!(args.field === "addColor" || args.field === "removeColor")) {
      return;
    }
    const field = args.field;
    updateCardInSearchQueries(localStore, args.cardId, (card) => ({
      ...card,
      colors: editPaletteColors(card.colors, field, hex),
      updatedAt: Date.now(),
    }));
  });

  const write = useCallback(
    async (field: PaletteField, value: string) => {
      // An added color is saved as the server saves it (alpha kept, so Undo
      // restores a removed color exactly); a removed one goes by its RGB.
      const hex =
        field === "addColor"
          ? paletteColorFromHex(value)?.hex
          : normalizeHexColor(value);
      if (!(cardId && hex)) {
        return false;
      }
      try {
        await updateCardField({ cardId, field, value: hex });
        return true;
      } catch {
        toast.error(t("saveFailed"));
        return false;
      }
    },
    [cardId, t, updateCardField]
  );

  const addColor = useCallback(
    (value: string) => write("addColor", value),
    [write]
  );

  const removeColor = useCallback(
    async (value: string) => {
      // A stored swatch, which can carry alpha (`#FF000080` saved from text):
      // the server takes its `#RRGGBB` and removes it by that.
      const hex = normalizeHexColor(value);
      if (!(hex && (await write("removeColor", hex)))) {
        return;
      }
      toast.success(t("removed", { hex }), {
        duration: UNDO_TOAST_DURATION_MS,
        id: `palette-remove-${cardId ?? ""}-${hex}`,
        action: {
          label: tc("undo"),
          onClick: () => void write("addColor", value),
        },
      });
    },
    [cardId, t, tc, write]
  );

  return { addColor, removeColor };
}
