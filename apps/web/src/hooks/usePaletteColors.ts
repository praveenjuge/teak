import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { parsePaletteHex } from "@teak/convex/shared/utils/colorUtils";
import { useTranslations } from "@teak/i18n/react";
import { useMutation } from "convex/react";
import { useCallback } from "react";
import { toast } from "sonner";
import { UNDO_TOAST_DURATION_MS } from "../constants/toast";
import { updateCardInSearchQueries } from "../lib/cardQueryOptimisticUpdates";
import { editPaletteColors, type PaletteField } from "./paletteColors";

/** Adds and removes a palette card's colors, with Undo for a removal. */
export function usePaletteColors(cardId: Id<"cards">) {
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
      const hex = parsePaletteHex(value);
      if (!hex) {
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
      const hex = parsePaletteHex(value);
      if (!(hex && (await write("removeColor", hex)))) {
        return;
      }
      toast.success(t("removed", { hex }), {
        duration: UNDO_TOAST_DURATION_MS,
        id: `palette-remove-${cardId}-${hex}`,
        action: {
          label: tc("undo"),
          onClick: () => void write("addColor", hex),
        },
      });
    },
    [cardId, t, tc, write]
  );

  return { addColor, removeColor };
}
