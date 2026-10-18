import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { captureEvent } from "@teak/convex/shared/analytics";
import { CARD_ERROR_CODES } from "@teak/convex/shared/constants";
import { useAction } from "convex/react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { CARD_LIMIT_TOAST_MESSAGE } from "../constants/toast";

const SAVE_PDF_ERRORS: Record<string, string> = {
  [CARD_ERROR_CODES.CARD_LIMIT_REACHED]: CARD_LIMIT_TOAST_MESSAGE,
  [CARD_ERROR_CODES.RATE_LIMITED]:
    "You're saving quickly. Try again in a minute.",
  IN_PROGRESS: "This PDF is already being saved. Try again in a moment.",
};
const SAVE_PDF_FAILED = "Couldn't save the PDF. Try again.";

/** What a refused save says; anything unexpected reads as a retry. */
export const savePdfErrorMessage = (error: unknown): string => {
  const code = (error as { data?: { code?: unknown } } | null)?.data?.code;
  return (typeof code === "string" && SAVE_PDF_ERRORS[code]) || SAVE_PDF_FAILED;
};

/**
 * Save PDF for an arXiv link: the paper becomes its own document card. One
 * save per card at a time; the toast's Open shows the document.
 */
export function useSaveLinkedPdf(onOpenCard?: (cardId: string) => void) {
  const savePdf = useAction(api.card.saveLinkedPdf.saveLinkedPdf);
  const inFlight = useRef(new Set<string>());
  const [savingCardId, setSavingCardId] = useState<string | null>(null);

  const save = useCallback(
    async (cardId: string) => {
      if (inFlight.current.has(cardId)) {
        return;
      }
      inFlight.current.add(cardId);
      setSavingCardId(cardId);
      try {
        const saved = await savePdf({ cardId: cardId as Id<"cards"> });
        if (saved.created) {
          captureEvent("link_pdf_saved", { source: "panel" });
        }
        toast.success(saved.created ? "PDF saved" : "Already saved", {
          ...(onOpenCard
            ? {
                action: {
                  label: "Open",
                  onClick: () => onOpenCard(saved.cardId),
                },
              }
            : {}),
        });
      } catch (error) {
        toast.error(savePdfErrorMessage(error));
      } finally {
        inFlight.current.delete(cardId);
        setSavingCardId((current) => (current === cardId ? null : current));
      }
    },
    [onOpenCard, savePdf]
  );

  return { save, savingCardId };
}
