import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { getReprocessErrorMessage } from "../lib/reprocessError";

/**
 * "Refresh details" for one card at a time: regenerates the summary, tags and
 * transcript (and link metadata) in the background. Repeat clicks while a
 * request is in flight are ignored; the backend limits the rest.
 */
export function useReprocessCard() {
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
          toast.error(result.message);
        } else {
          toast.success(
            "Refreshing details. The summary and tags update shortly."
          );
        }
      } catch (error) {
        toast.error(getReprocessErrorMessage(error));
      } finally {
        inFlight.current.delete(cardId);
        setPendingCardId((current) => (current === cardId ? null : current));
      }
    },
    [reprocessCard]
  );

  return { pendingCardId, reprocess };
}
