import {
  captureClientException,
  runClientSpan,
} from "../../shared/client-telemetry";
import type { Id } from "../../shared/types";

export interface CardActionsConfig {
  onDeleteSuccess?: (message?: string) => void;
  onError?: (error: Error, operation: string) => void;
  onPermanentDeleteSuccess?: (message?: string) => void;
  onRestoreSuccess?: (message?: string) => void;
}

export interface UpdateCardFieldArgs {
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
  tagToRemove?: string;
  value?: any;
}

export interface PermanentDeleteCardArgs {
  id: Id<"cards">;
}

export interface CardActionsDependencies {
  permanentDeleteCard: (args: PermanentDeleteCardArgs) => Promise<unknown>;
  updateCardField: (args: UpdateCardFieldArgs) => Promise<unknown>;
}

export interface BulkDeleteResult {
  deletedCount: number;
  failedIds: Id<"cards">[];
  requestedCount: number;
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
      await runClientSpan(
        {
          name: "card.delete",
          operation: "teak.workflow",
          stage: "persistence",
        },
        () => updateCardField({ cardId, field: "delete" })
      );
      if (!options.suppressSuccessCallback) {
        config.onDeleteSuccess?.("Card deleted. Find it by searching 'trash'");
      }
      return true;
    } catch (error) {
      captureClientException(error, { operation: "card.delete" });
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
      await runClientSpan(
        {
          name: "card.restore",
          operation: "teak.workflow",
          stage: "persistence",
        },
        () => updateCardField({ cardId, field: "restore" })
      );
      config.onRestoreSuccess?.("Card restored");
    } catch (error) {
      captureClientException(error, { operation: "card.restore" });
      config.onError?.(error as Error, "restore");
    }
  };

  const handlePermanentDeleteCard = async (cardId: Id<"cards">) => {
    try {
      await runClientSpan(
        {
          name: "card.permanent_delete",
          operation: "teak.workflow",
          stage: "persistence",
        },
        () => permanentDeleteCard({ id: cardId })
      );
      config.onPermanentDeleteSuccess?.("Card permanently deleted");
    } catch (error) {
      captureClientException(error, { operation: "card.permanent_delete" });
      config.onError?.(error as Error, "permanent delete");
    }
  };

  const handleToggleFavorite = async (cardId: Id<"cards">) => {
    try {
      await runClientSpan(
        {
          name: "card.favorite",
          operation: "teak.workflow",
          stage: "persistence",
        },
        () =>
          updateCardField({
            cardId,
            field: "isFavorited",
          })
      );
    } catch (error) {
      captureClientException(error, { operation: "card.favorite" });
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
      await runClientSpan(
        {
          attributes: { field },
          name: "card.update",
          operation: "teak.workflow",
          stage: "persistence",
        },
        () =>
          updateCardField({
            cardId,
            field,
            value,
            tagToRemove,
          })
      );
    } catch (error) {
      captureClientException(error, { field, operation: "card.update" });
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
