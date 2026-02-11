import type { Id } from "../../shared/types";

// Sentry capture function - will be injected by platform-specific wrappers
type SentryCaptureFunction = (
  error: unknown,
  context?: { tags?: Record<string, string>; extra?: Record<string, unknown> }
) => void;
let captureException: SentryCaptureFunction = () => {};

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

export interface BulkDeleteResult {
  requestedCount: number;
  deletedCount: number;
  failedIds: Id<"cards">[];
}

export function createCardActions(
  { permanentDeleteCard, updateCardField }: CardActionsDependencies,
  config: CardActionsConfig = {}
) {
  const deleteCardInternal = async (
    cardId: Id<"cards">,
    options: {
      suppressSuccessCallback?: boolean;
      suppressErrorCallback?: boolean;
    } = {}
  ): Promise<boolean> => {
    try {
      await updateCardField({ cardId, field: "delete" });
      if (!options.suppressSuccessCallback) {
        config.onDeleteSuccess?.("Card deleted. Find it by searching 'trash'");
      }
      return true;
    } catch (error) {
      console.error("Failed to delete card:", error);
      captureException(error, {
        tags: {
          source: "convex",
          mutation: "cards:updateCardField",
          operation: "delete",
        },
        extra: { cardId },
      });
      if (!options.suppressErrorCallback) {
        config.onError?.(error as Error, "delete");
      }
      return false;
    }
  };

  const handleDeleteCard = (cardId: Id<"cards">) => deleteCardInternal(cardId);

  const handleBulkDeleteCards = async (
    cardIds: Id<"cards">[]
  ): Promise<BulkDeleteResult> => {
    const failedIds: Id<"cards">[] = [];
    let deletedCount = 0;

    for (const cardId of cardIds) {
      const didDelete = await deleteCardInternal(cardId, {
        suppressSuccessCallback: true,
        suppressErrorCallback: true,
      });
      if (didDelete) {
        deletedCount += 1;
      } else {
        failedIds.push(cardId);
      }
    }

    return {
      requestedCount: cardIds.length,
      deletedCount,
      failedIds,
    };
  };

  const handleRestoreCard = async (cardId: Id<"cards">) => {
    try {
      await updateCardField({ cardId, field: "restore" });
      config.onRestoreSuccess?.("Card restored");
    } catch (error) {
      console.error("Failed to restore card:", error);
      captureException(error, {
        tags: {
          source: "convex",
          mutation: "cards:updateCardField",
          operation: "restore",
        },
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
        tags: {
          source: "convex",
          mutation: "cards:updateCardField",
          operation: "toggleFavorite",
        },
        extra: { cardId },
      });
      config.onError?.(error as Error, "toggle favorite");
    }
  };

  // New unified field update method
  const updateField = async (
    cardId: Id<"cards">,
    field:
      | "content"
      | "url"
      | "notes"
      | "tags"
      | "aiSummary"
      | "isFavorited"
      | "removeAiTag"
      | "delete"
      | "restore",
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
        tags: {
          source: "convex",
          mutation: "cards:updateCardField",
          operation: `update_${field}`,
        },
        extra: { cardId, field, value },
      });
      config.onError?.(error as Error, `update ${field}`);
    }
  };

  return {
    handleDeleteCard,
    handleBulkDeleteCards,
    handleRestoreCard,
    handlePermanentDeleteCard,
    handleToggleFavorite,
    updateField, // New unified update method
  };
}
