import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { toast } from "sonner";

export function useCardActions() {
  const deleteCard = useMutation(api.cards.deleteCard);
  const restoreCard = useMutation(api.cards.restoreCard);
  const permanentDeleteCard = useMutation(api.cards.permanentDeleteCard);
  const toggleFavorite = useMutation(api.cards.toggleFavorite);

  const handleDeleteCard = async (cardId: string) => {
    try {
      await deleteCard({ id: cardId as Id<"cards"> });
      toast("Card deleted. Find it by searching 'trash'");
    } catch (error) {
      console.error("Failed to delete card:", error);
      toast.error("Failed to delete card");
    }
  };

  const handleRestoreCard = async (cardId: string) => {
    try {
      await restoreCard({ id: cardId as Id<"cards"> });
      toast("Card restored");
    } catch (error) {
      console.error("Failed to restore card:", error);
      toast.error("Failed to restore card");
    }
  };

  const handlePermanentDeleteCard = async (cardId: string) => {
    try {
      await permanentDeleteCard({ id: cardId as Id<"cards"> });
      toast("Card permanently deleted");
    } catch (error) {
      console.error("Failed to permanently delete card:", error);
      toast.error("Failed to permanently delete card");
    }
  };

  const handleToggleFavorite = async (cardId: string) => {
    try {
      await toggleFavorite({ id: cardId as Id<"cards"> });
    } catch (error) {
      console.error("Failed to toggle favorite:", error);
    }
  };

  return {
    handleDeleteCard,
    handleRestoreCard,
    handlePermanentDeleteCard,
    handleToggleFavorite,
  };
}