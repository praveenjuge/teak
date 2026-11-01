import { isCardType } from "@teak/convex/shared/constants";
import {
  createTeakTranslator,
  englishMessages,
  type TeakTranslator,
} from "@teak/i18n";

export type CardTypesTranslator = TeakTranslator<"cards.types">;

export const englishCardTypes: CardTypesTranslator = createTeakTranslator(
  "en",
  englishMessages,
  "cards.types"
);

export function cardTypeLabel(
  type: string | undefined,
  t: CardTypesTranslator = englishCardTypes
): string {
  return type && isCardType(type) ? t(type) : t("card");
}
