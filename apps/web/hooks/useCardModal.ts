import { toast } from "sonner";
import { useCardModal as useBaseCardModal } from "@teak/shared";

export function useCardModal(cardId: string | null, config?: { onCardTypeClick?: (cardType: string) => void }) {
  return useBaseCardModal(cardId, {
    onError: (error, operation) => {
      toast.error(`Failed to ${operation}`);
    },
    onOpenLink: (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onCardTypeClick: config?.onCardTypeClick,
  });
}