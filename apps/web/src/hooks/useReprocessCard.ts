import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { useTranslations } from "@teak/i18n/react";
import { useMutation } from "convex/react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { getReprocessErrorMessage } from "../lib/reprocessError";
import { useServerErrors } from "./useServerErrors";

export function useReprocessCard() {
  const t = useTranslations("hooks.reprocess");
  const tl = useTranslations("lib.reprocess");
  const errors = useTranslations("errors");
  const serverErrors = useServerErrors();
  const reprocessCard = useMutation(api.cards.reprocessCard);
  const inFlight = useRef(new Set<string>());
  const [pendingCardId, setPendingCardId] = useState<string | null>(null);

  const reprocess = useCallback(
    async (cardId: string) => {
      if (inFlight.current.has(cardId)) {
        return;
      }
      inFlight.current.add(cardId);
      setPendingCardId(cardId);
      try {
        const result = await reprocessCard({ cardId: cardId as Id<"cards"> });
        if (result.status === "refused") {
          toast.error(serverErrors.byEnglishMessage(result.message));
        } else {
          toast.success(t("started"));
        }
      } catch (error) {
        toast.error(getReprocessErrorMessage(error, tl, errors));
      } finally {
        inFlight.current.delete(cardId);
        setPendingCardId((current) => (current === cardId ? null : current));
      }
    },
    [errors, reprocessCard, serverErrors, t, tl]
  );

  return { pendingCardId, reprocess };
}
