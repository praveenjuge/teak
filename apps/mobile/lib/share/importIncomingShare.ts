import {
  CARD_ERROR_MESSAGES,
  MAX_FILE_SIZE,
  MAX_FILES_PER_UPLOAD,
} from "@teak/convex/shared/constants";
import { createCardFromText } from "@/lib/createCardFromText";
import type {
  NormalizedShareItem,
  ShareImportFailure,
  ShareImportResult,
  ShareUploadResult,
} from "@/lib/share/types";
import type { UploadFileFromUriParams } from "@/lib/share/uploadFileFromUri";

export interface ImportIncomingShareDependencies {
  createCard: (args: {
    content: string;
    type?: "link";
    url?: string;
  }) => Promise<unknown>;
  uploadFileFromUri: (
    params: UploadFileFromUriParams
  ) => Promise<ShareUploadResult>;
}

export interface ImportIncomingShareOptions {
  isAuthenticated: boolean;
  maxItems?: number;
}

function pushFailure(
  failures: ShareImportFailure[],
  itemId: string,
  reason: ShareImportFailure["reason"],
  message: string
) {
  failures.push({ itemId, reason, message });
}

export async function importIncomingShareItems(
  items: NormalizedShareItem[],
  dependencies: ImportIncomingShareDependencies,
  options: ImportIncomingShareOptions
): Promise<ShareImportResult> {
  const maxItems = options.maxItems ?? MAX_FILES_PER_UPLOAD;
  const processableItems = items.slice(0, maxItems);
  const skippedItems = items.slice(maxItems);

  const failures: ShareImportFailure[] = skippedItems.map((item) => ({
    itemId: item.id,
    reason: "TOO_MANY_ITEMS",
    message: `Only the first ${maxItems} shared items are processed.`,
  }));
  const createdCardIds: string[] = [];

  if (!options.isAuthenticated) {
    for (const item of processableItems) {
      pushFailure(
        failures,
        item.id,
        "UNAUTHENTICATED",
        "Sign in to save shared content."
      );
    }

    return {
      totalItems: items.length,
      attemptedItems: processableItems.length,
      successfulItems: 0,
      failedItems: failures.length,
      failures,
      createdCardIds,
    };
  }

  for (const item of processableItems) {
    if (item.kind === "text") {
      try {
        const createdCard = await createCardFromText(item.content, {
          createCard: dependencies.createCard,
        });

        if (typeof createdCard === "string") {
          createdCardIds.push(createdCard);
        }
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Failed to create card from shared text.";
        pushFailure(failures, item.id, "CREATE_FAILED", message);
      }

      continue;
    }

    if (typeof item.fileSize === "number" && item.fileSize > MAX_FILE_SIZE) {
      pushFailure(
        failures,
        item.id,
        "FILE_TOO_LARGE",
        CARD_ERROR_MESSAGES.FILE_TOO_LARGE
      );
      continue;
    }

    const uploadResult = await dependencies
      .uploadFileFromUri({
        content: item.content,
        fileName: item.fileName,
        fileUri: item.fileUri,
        mimeType: item.mimeType,
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Failed to upload shared file.";
        pushFailure(failures, item.id, "UPLOAD_FAILED", message);
        return null;
      });

    if (!uploadResult) {
      continue;
    }

    if (!uploadResult.success) {
      pushFailure(
        failures,
        item.id,
        "UPLOAD_FAILED",
        uploadResult.error ?? "Failed to upload shared file."
      );
      continue;
    }

    if (typeof uploadResult.cardId === "string") {
      createdCardIds.push(uploadResult.cardId);
    }
  }

  const successfulItems =
    processableItems.length - (failures.length - skippedItems.length);

  return {
    totalItems: items.length,
    attemptedItems: processableItems.length,
    successfulItems,
    failedItems: failures.length,
    failures,
    createdCardIds,
  };
}
