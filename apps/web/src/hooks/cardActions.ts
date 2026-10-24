import { captureClientException } from "@teak/convex/shared/clientTelemetry";
import type { Id } from "@teak/convex/shared/types";
import type { TeakTranslator } from "@teak/i18n";
import { englishTranslator } from "@/lib/englishTranslators";

export type CardActionsTranslator = TeakTranslator<"hooks.cardActions">;

const englishCardActions: CardActionsTranslator =
  englishTranslator("hooks.cardActions");

const FAILED_OPERATION_KEYS = {
  delete: "failed.delete",
  restore: "failed.restore",
  "permanent delete": "failed.permanentDelete",
  "toggle favorite": "failed.toggleFavorite",
  "save changes": "failed.saveChanges",
  "download file": "failed.downloadFile",
} as const;

const UPDATE_PREFIX = "update ";

/**
 * "Failed to …" for an operation passed to `onError`, such as `"delete"` or
 * `"update tags"`. An update names the field as the code does.
 */
export const cardActionFailedMessage = (
  operation: string,
  t: CardActionsTranslator = englishCardActions
): string => {
  if (operation in FAILED_OPERATION_KEYS) {
    return t(
      FAILED_OPERATION_KEYS[operation as keyof typeof FAILED_OPERATION_KEYS]
    );
  }
  if (operation.startsWith(UPDATE_PREFIX)) {
    return t("failed.update", {
      field: operation.slice(UPDATE_PREFIX.length),
    });
  }
  return t("failed.other", { operation });
};

export interface CardActionsConfig {
  onDeleteSuccess?: (message?: string) => void;
  onError?: (error: Error, operation: string) => void;
  onPermanentDeleteSuccess?: (message?: string) => void;
  onRestoreSuccess?: (message?: string) => void;
}

export type CardFieldValue = string | string[] | boolean | null;

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
  value?: CardFieldValue;
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
  config: CardActionsConfig = {},
  t: CardActionsTranslator = englishCardActions
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
        config.onDeleteSuccess?.(t("deletedFindInTrash"));
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
      await updateCardField({ cardId, field: "restore" });
      config.onRestoreSuccess?.(t("cardRestored"));
    } catch (error) {
      captureClientException(error, { operation: "card.restore" });
      config.onError?.(error as Error, "restore");
    }
  };

  const handlePermanentDeleteCard = async (cardId: Id<"cards">) => {
    try {
      await permanentDeleteCard({ id: cardId });
      config.onPermanentDeleteSuccess?.(t("cardPermanentlyDeleted"));
    } catch (error) {
      captureClientException(error, { operation: "card.permanent_delete" });
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
      captureClientException(error, { operation: "card.favorite" });
      config.onError?.(error as Error, "toggle favorite");
    }
  };

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
    value?: CardFieldValue,
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
    updateField,
  };
}
