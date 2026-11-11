import type { TeakTranslator } from "@teak/i18n";
import type { ClientCard } from "@/lib/cardTypes";
import { englishTranslator } from "@/lib/englishTranslators";
import type { CardSaveState } from "../../hooks/useCardModal";
import { hasEditableText } from "../../lib/cardTypes";
import type { GetCurrentValue } from "./types";

export type CardModalTranslator = TeakTranslator<"cardModal">;

export const englishCardModal: CardModalTranslator =
  englishTranslator("cardModal");

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

export function emptiedContentNotice(
  card: ClientCard | null | undefined,
  getCurrentValue: GetCurrentValue,
  t: CardModalTranslator = englishCardModal
): string | null {
  if (
    !(card && hasEditableText(card.type)) ||
    card.isDeleted ||
    !card.content?.trim() ||
    (getCurrentValue("content") ?? "").trim()
  ) {
    return null;
  }
  return card.type === "quote" ? t("toasts.emptyQuote") : t("toasts.emptyNote");
}
