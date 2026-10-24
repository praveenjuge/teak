import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { captureEvent } from "@teak/convex/shared/analytics";
import { CARD_ERROR_CODES } from "@teak/convex/shared/constants";
import type { TeakTranslator } from "@teak/i18n";
import { useTranslations } from "@teak/i18n/react";
import { useAction } from "convex/react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { englishErrors, englishTranslator } from "@/lib/englishTranslators";
import { type ErrorsTranslator, translateErrorKey } from "@/lib/serverErrors";

export type SavePdfTranslator = TeakTranslator<"hooks.savePdf">;

const englishSavePdf: SavePdfTranslator = englishTranslator("hooks.savePdf");

export const savePdfErrorMessage = (
  error: unknown,
  t: SavePdfTranslator = englishSavePdf,
  errors: ErrorsTranslator = englishErrors
): string => {
  const code = (error as { data?: { code?: unknown } } | null)?.data?.code;
  switch (code) {
    case CARD_ERROR_CODES.CARD_LIMIT_REACHED:
      return t("cardLimitReached");
    case CARD_ERROR_CODES.RATE_LIMITED:
      return translateErrorKey(errors, "pdfs.RATE_LIMITED");
    case "IN_PROGRESS":
      return translateErrorKey(errors, "pdfs.IN_PROGRESS");
    case "FILE_TOO_LARGE":
      return t("tooLarge");
    case "UNSUPPORTED_TYPE":
      return t("notPdf");
    default:
      return t("failed");
  }
};

const withoutCard = (cardIds: ReadonlySet<string>, cardId: string) => {
  const next = new Set(cardIds);
  next.delete(cardId);
  return next;
};

export function useSaveLinkedPdf(onOpenCard?: (cardId: string) => void) {
  const t = useTranslations("hooks.savePdf");
  const errors = useTranslations("errors");
  const savePdf = useAction(api.card.saveLinkedPdf.saveLinkedPdf);
  const inFlight = useRef(new Set<string>());
  const [savingCardIds, setSavingCardIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  const save = useCallback(
    async (cardId: string) => {
      if (inFlight.current.has(cardId)) {
        return;
      }
      inFlight.current.add(cardId);
      setSavingCardIds((current) => new Set(current).add(cardId));
      try {
        const saved = await savePdf({ cardId: cardId as Id<"cards"> });
        if (saved.created) {
          captureEvent("link_pdf_saved", { source: "panel" });
        }
        toast.success(saved.created ? t("saved") : t("alreadySaved"), {
          ...(onOpenCard
            ? {
                action: {
                  label: t("open"),
                  onClick: () => onOpenCard(saved.cardId),
                },
              }
            : {}),
        });
      } catch (error) {
        toast.error(savePdfErrorMessage(error, t, errors));
      } finally {
        inFlight.current.delete(cardId);
        setSavingCardIds((current) => withoutCard(current, cardId));
      }
    },
    [errors, onOpenCard, savePdf, t]
  );

  const isSaving = useCallback(
    (cardId: string) => savingCardIds.has(cardId),
    [savingCardIds]
  );

  return { isSaving, save };
}
