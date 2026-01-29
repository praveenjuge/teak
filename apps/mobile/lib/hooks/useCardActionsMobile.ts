import { Alert } from "react-native";
import { useMutation } from "convex/react";
import { api } from "@teak/convex";
import { createCardActions } from "@teak/convex/shared/hooks/useCardActions";

export function useCardActions() {
  const permanentDeleteCard = useMutation(api.cards.permanentDeleteCard);
  const updateCardField = useMutation(api.cards.updateCardField);

  return createCardActions(
    { permanentDeleteCard, updateCardField },
    {
      onDeleteSuccess: (message) => {
        Alert.alert("Success", message || "Card deleted successfully");
      },
      onRestoreSuccess: (message) => {
        Alert.alert("Success", message || "Card restored successfully");
      },
      onPermanentDeleteSuccess: (message) => {
        Alert.alert("Success", message || "Card permanently deleted");
      },
      onError: (_error, operation) => {
        Alert.alert("Error", `Failed to ${operation}. Please try again.`);
      },
    }
  );
}
