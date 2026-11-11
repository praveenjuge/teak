import { isCardType } from "@teak/convex/shared/constants";
import type { TeakTranslator } from "@teak/i18n";

export type CardTypesTranslator = TeakTranslator<"cards.types">;

export function cardTypeLabel(
  type: string | undefined,
  t: CardTypesTranslator
): string {
  return type && isCardType(type) ? t(type) : t("card");
}
