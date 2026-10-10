import { api } from "@teak/convex";
import { createCardActions } from "@teak/convex/shared/hooks/useCardActions";
import { useMutation } from "convex/react";
import { Alert } from "react-native";
import { triggerSuccessHaptic } from "@/lib/haptics";

export function useCardActions() {
  const permanentDeleteCard = useMutation(api.cards.permanentDeleteCard);
  const updateCardField = useMutation(api.cards.updateCardField);

  return createCardActions(
    { permanentDeleteCard, updateCardField },
    {
      // The card leaving Trash is the confirmation, like Photos.
      onRestoreSuccess: () => {
        void triggerSuccessHaptic();
      },
      onPermanentDeleteSuccess: () => {
        void triggerSuccessHaptic();
      },
      onError: (_error, operation) => {
        Alert.alert("Error", `Failed to ${operation}. Please try again.`);
      },
    }
  );
}
