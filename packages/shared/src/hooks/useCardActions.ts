import { useMutation } from "convex/react";
import { api } from "@teak/convex";
import { Id } from "@teak/convex/_generated/dataModel";

export interface CardActionsConfig {
  onDeleteSuccess?: (message?: string) => void;
  onRestoreSuccess?: (message?: string) => void;
  onPermanentDeleteSuccess?: (message?: string) => void;
  onError?: (error: Error, operation: string) => void;
}

export function useCardActions(config: CardActionsConfig = {}) {
  const deleteCard = useMutation(api.cards.deleteCard);
  const restoreCard = useMutation(api.cards.restoreCard);
  const permanentDeleteCard = useMutation(api.cards.permanentDeleteCard);
  const toggleFavorite = useMutation(api.cards.toggleFavorite);
  const updateCardField = useMutation(api.cards.updateCardField);

  const handleDeleteCard = async (cardId: Id<"cards">) => {
    try {
      await deleteCard({ id: cardId });
      config.onDeleteSuccess?.("Card deleted. Find it by searching 'trash'");
    } catch (error) {
      console.error("Failed to delete card:", error);
      config.onError?.(error as Error, "delete");
    }
  };

  const handleRestoreCard = async (cardId: Id<"cards">) => {
    try {
      await restoreCard({ id: cardId });
      config.onRestoreSuccess?.("Card restored");
    } catch (error) {
      console.error("Failed to restore card:", error);
      config.onError?.(error as Error, "restore");
    }
  };

  const handlePermanentDeleteCard = async (cardId: Id<"cards">) => {
    try {
      await permanentDeleteCard({ id: cardId });
      config.onPermanentDeleteSuccess?.("Card permanently deleted");
    } catch (error) {
      console.error("Failed to permanently delete card:", error);
      config.onError?.(error as Error, "permanent delete");
    }
  };

  const handleToggleFavorite = async (cardId: Id<"cards">) => {
    try {
      await toggleFavorite({ id: cardId });
    } catch (error) {
      console.error("Failed to toggle favorite:", error);
      config.onError?.(error as Error, "toggle favorite");
    }
  };

  // New unified field update method
  const updateField = async (
    cardId: Id<"cards">,
    field: "content" | "url" | "notes" | "tags" | "aiSummary" | "isFavorited" | "removeAiTag",
    value?: any,
    tagToRemove?: string
  ) => {
    try {
      await updateCardField({
        cardId,
        field,
        value,
        tagToRemove,
      });
    } catch (error) {
      console.error(`Failed to update ${field}:`, error);
      config.onError?.(error as Error, `update ${field}`);
    }
  };

  return {
    handleDeleteCard,
    handleRestoreCard,
    handlePermanentDeleteCard,
    handleToggleFavorite,
    updateField, // New unified update method
  };
}