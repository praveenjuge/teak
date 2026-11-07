import type { Id } from "@teak/convex/_generated/dataModel";
import {
  normalizeHexColor,
  paletteColorFromHex,
} from "@teak/convex/shared/utils/colorUtils";
import { useTranslations } from "@teak/i18n/react";
import { useCallback } from "react";
import { toast } from "sonner";
import { UNDO_TOAST_DURATION_MS } from "../constants/toast";
import type { PaletteField } from "../lib/paletteColors";
import { useUpdateCardField } from "./useCardMutations";

export interface PaletteColorsControl {
  addColor: (hex: string) => Promise<boolean>;
  removeColor: (hex: string) => Promise<void>;
}

export function usePaletteColors(
  cardId: Id<"cards"> | undefined
): PaletteColorsControl {
  const t = useTranslations("cardPreviews.palette");
  const tc = useTranslations("common");
  const updateCardField = useUpdateCardField();

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
