import type { Id } from "../../shared/types";

// Sentry capture function - will be injected by platform-specific wrappers
type SentryCaptureFunction = (error: unknown, context?: { tags?: Record<string, string>; extra?: Record<string, unknown> }) => void;
let captureException: SentryCaptureFunction = () => { };

export function setSentryCaptureFunction(fn: SentryCaptureFunction) {
  captureException = fn;
}

export interface CardActionsConfig {
  onDeleteSuccess?: (message?: string) => void;
  onRestoreSuccess?: (message?: string) => void;
  onPermanentDeleteSuccess?: (message?: string) => void;
  onError?: (error: Error, operation: string) => void;
}

export type UpdateCardFieldArgs = {
  cardId: Id<"cards">;
  field:
  | "content"
  | "url"
  | "notes"
  | "tags"
  | "aiSummary"
  | "isFavorited"
  | "removeAiTag"
  | "delete"
  | "restore";
  value?: any;
  tagToRemove?: string;
};

export type PermanentDeleteCardArgs = {
  id: Id<"cards">;
};

export interface CardActionsDependencies {
  permanentDeleteCard: (args: PermanentDeleteCardArgs) => Promise<unknown>;
  updateCardField: (args: UpdateCardFieldArgs) => Promise<unknown>;
}

export function createCardActions(
  { permanentDeleteCard, updateCardField }: CardActionsDependencies,
  config: CardActionsConfig = {}
) {

  const handleDeleteCard = async (cardId: Id<"cards">) => {
    try {
      await updateCardField({ cardId, field: "delete" });
      config.onDeleteSuccess?.("Card deleted. Find it by searching 'trash'");
    } catch (error) {
      console.error("Failed to delete card:", error);
      captureException(error, {
        tags: { source: "convex", mutation: "cards:updateCardField", operation: "delete" },
        extra: { cardId },
      });
      config.onError?.(error as Error, "delete");
    }
  };

  const handleRestoreCard = async (cardId: Id<"cards">) => {
    try {
      await updateCardField({ cardId, field: "restore" });
      config.onRestoreSuccess?.("Card restored");
    } catch (error) {
      console.error("Failed to restore card:", error);
      captureException(error, {
        tags: { source: "convex", mutation: "cards:updateCardField", operation: "restore" },
        extra: { cardId },
      });
      config.onError?.(error as Error, "restore");
    }
  };

  const handlePermanentDeleteCard = async (cardId: Id<"cards">) => {
    try {
      await permanentDeleteCard({ id: cardId });
      config.onPermanentDeleteSuccess?.("Card permanently deleted");
    } catch (error) {
      console.error("Failed to permanently delete card:", error);
      captureException(error, {
        tags: { source: "convex", mutation: "cards:permanentDeleteCard" },
        extra: { cardId },
      });
      config.onError?.(error as Error, "permanent delete");
    }
  };

  const handleToggleFavorite = async (cardId: Id<"cards">) => {
    try {
      await updateCardField({
        cardId,
        field: "isFavorited",
      });
    } catch (error) {
      console.error("Failed to toggle favorite:", error);
      captureException(error, {
        tags: { source: "convex", mutation: "cards:updateCardField", operation: "toggleFavorite" },
        extra: { cardId },
      });
      config.onError?.(error as Error, "toggle favorite");
    }
  };

  // New unified field update method
  const updateField = async (
    cardId: Id<"cards">,
    field: "content" | "url" | "notes" | "tags" | "aiSummary" | "isFavorited" | "removeAiTag" | "delete" | "restore",
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
      captureException(error, {
        tags: { source: "convex", mutation: "cards:updateCardField", operation: `update_${field}` },
        extra: { cardId, field, value },
      });
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
