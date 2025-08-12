import { useMutation } from "convex/react";
import { api } from "@teak/convex";
import { Id } from "@teak/convex/_generated/dataModel";
import { toast } from "sonner";

export function useCardActions() {
  const deleteCard = useMutation(api.cards.deleteCard);
  const restoreCard = useMutation(api.cards.restoreCard);
  const permanentDeleteCard = useMutation(api.cards.permanentDeleteCard);
  const toggleFavorite = useMutation(api.cards.toggleFavorite);
  const updateCardField = useMutation(api.cards.updateCardField);

  const handleDeleteCard = async (cardId: Id<"cards">) => {
    try {
      await deleteCard({ id: cardId });
      toast("Card deleted. Find it by searching 'trash'");
    } catch (error) {
      console.error("Failed to delete card:", error);
      toast.error("Failed to delete card");
    }
  };

  const handleRestoreCard = async (cardId: Id<"cards">) => {
    try {
      await restoreCard({ id: cardId });
      toast("Card restored");
    } catch (error) {
      console.error("Failed to restore card:", error);
      toast.error("Failed to restore card");
    }
  };

  const handlePermanentDeleteCard = async (cardId: Id<"cards">) => {
    try {
      await permanentDeleteCard({ id: cardId });
      toast("Card permanently deleted");
    } catch (error) {
      console.error("Failed to permanently delete card:", error);
      toast.error("Failed to permanently delete card");
    }
  };

  const handleToggleFavorite = async (cardId: Id<"cards">) => {
    try {
      await toggleFavorite({ id: cardId });
    } catch (error) {
      console.error("Failed to toggle favorite:", error);
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
      toast.error(`Failed to update ${field}`);
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