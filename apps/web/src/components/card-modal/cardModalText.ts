import {
  createTeakTranslator,
  englishMessages,
  type TeakTranslator,
} from "@teak/i18n";
import type { CardSaveState } from "../../hooks/useCardModal";
import type { CardModalCard, GetCurrentValue } from "./types";

export type CardModalTranslator = TeakTranslator<"cardModal">;

export const englishCardModal: CardModalTranslator = createTeakTranslator(
  "en",
  englishMessages,
  "cardModal"
);

export function saveStateLabel(
  state: CardSaveState,
  t: CardModalTranslator,
  tc: TeakTranslator<"common">
): string {
  switch (state) {
    case "unsaved":
      return t("saveState.unsaved");
    case "saving":
      return tc("saving");
    case "saved":
      return t("saveState.saved");
    case "error":
      return t("saveState.error");
    default:
      return "";
  }
}

/**
 * What to say when a note or quote is left emptied: an empty one isn't
 * saved (the composer won't make one either), so it keeps its last text.
 */
export function emptiedContentNotice(
  card: CardModalCard | null | undefined,
  getCurrentValue: GetCurrentValue,
  t: CardModalTranslator = englishCardModal
): string | null {
  if (
    !(card && (card.type === "text" || card.type === "quote")) ||
    card.isDeleted ||
    !card.content?.trim() ||
    (getCurrentValue("content") ?? "").trim()
  ) {
    return null;
  }
  return card.type === "quote" ? t("toasts.emptyQuote") : t("toasts.emptyNote");
}
