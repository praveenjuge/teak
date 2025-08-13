import { toast } from "sonner";
import { useCardActions as useBaseCardActions } from "@teak/shared";

export function useCardActions() {
  return useBaseCardActions({
    onDeleteSuccess: (message) => message && toast(message),
    onRestoreSuccess: (message) => message && toast(message),
    onPermanentDeleteSuccess: (message) => message && toast(message),
    onError: (error, operation) => {
      toast.error(`Failed to ${operation}`);
    },
  });
}