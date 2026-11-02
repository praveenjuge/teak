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
  "update delete": "failed.delete",
  "update restore": "failed.restore",
  "update isFavorited": "failed.toggleFavorite",
  "update removeAiTag": "failed.removeTag",
  "update tags": "failed.tags",
} as const;

const UPDATE_PREFIX = "update ";

/**
 * "Failed to …" for an operation passed to `onError`, such as `"delete"` or
 * `"update tags"`. Field names are code, so an update of any other field
 * reads as a failed save rather than naming the field.
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
    return t("failed.saveChanges");
  }
  return t("failed.other", { operation });
};

export interface CardActionsConfig {
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

  /** Deletes several cards in Trash forever, with one toast for all. */
  const handleBulkPermanentDeleteCards = async (
    cardIds: Id<"cards">[]
  ): Promise<BulkDeleteResult> => {
    const failedIds: Id<"cards">[] = [];
    let deletedCount = 0;
    let lastError: unknown;
    for (const cardId of cardIds) {
      try {
        await permanentDeleteCard({ id: cardId });
        deletedCount += 1;
      } catch (error) {
        captureClientException(error, { operation: "card.permanent_delete" });
        failedIds.push(cardId);
        lastError = error;
      }
    }
    if (deletedCount > 0) {
      config.onPermanentDeleteSuccess?.(
        t("cardsPermanentlyDeleted", { count: deletedCount })
      );
    }
    if (failedIds.length > 0) {
      config.onError?.(lastError as Error, "permanent delete");
    }
    return { deletedCount, failedIds, requestedCount: cardIds.length };
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
    handleRestoreCard,
    handlePermanentDeleteCard,
    handleBulkPermanentDeleteCards,
    updateField,
  };
}
