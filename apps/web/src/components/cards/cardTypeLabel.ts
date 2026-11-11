import { isCardType } from "@teak/convex/shared/constants";
import type { TeakTranslator } from "@teak/i18n";
import { englishTranslator } from "@/lib/englishTranslators";

export type CardTypesTranslator = TeakTranslator<"cards.types">;

export const englishCardTypes: CardTypesTranslator =
  englishTranslator("cards.types");

export function cardTypeLabel(
  type: string | undefined,
  t: CardTypesTranslator = englishCardTypes
): string {
  return type && isCardType(type) ? t(type) : t("card");
}
