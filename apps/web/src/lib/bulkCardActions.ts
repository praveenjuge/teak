import type { Doc } from "@teak/convex/_generated/dataModel";
import {
  type BulkCardAction,
  MAX_BULK_CARD_IDS,
} from "@teak/convex/shared/bulkCardActions";
import type { TeakTranslator } from "@teak/i18n";
import { clipFolderName } from "./clipFolderName";

export type BulkCopyTranslator = TeakTranslator<"lib.bulkCardActions">;

export interface BulkFolderTarget {
  folderId: string;
  folderName: string;
  fromFolderId?: string;
  fromFolderName?: string;
}

/** One request per this many cards: the most the server takes at once. */
export const BULK_CHUNK_SIZE = MAX_BULK_CARD_IDS;

export const UNDO_BULK_ACTION: Partial<Record<BulkCardAction, BulkCardAction>> =
  {
    archive: "unarchive",
    unarchive: "archive",
    delete: "restore",
  };

export interface BulkUndoStep {
  action: BulkCardAction;
  cardIds: string[];
  folder?: BulkFolderTarget;
}

export const folderUndoSteps = (
  action: BulkCardAction,
  target: BulkFolderTarget,
  updatedIds: readonly string[],
  before: ReadonlyMap<string, readonly string[]>
): BulkUndoStep[] | undefined => {
  const had = (cardId: string, folderId: string) =>
    (before.get(cardId) ?? []).includes(folderId);
  const destination = {
    folderId: target.folderId,
    folderName: target.folderName,
  };
  let steps: BulkUndoStep[];
  if (action === "addToFolder") {
    steps = [
      {
        action: "removeFromFolder",
        cardIds: updatedIds.filter((id) => !had(id, target.folderId)),
        folder: destination,
      },
    ];
  } else if (action === "removeFromFolder") {
    steps = [
      {
        action: "addToFolder",
        cardIds: updatedIds.filter((id) => had(id, target.folderId)),
        folder: destination,
      },
    ];
  } else if (action === "moveToFolder" && target.fromFolderId) {
    const source = target.fromFolderId;
    steps = [
      {
        action: "removeFromFolder",
        cardIds: updatedIds.filter((id) => !had(id, target.folderId)),
        folder: destination,
      },
      {
        action: "addToFolder",
        cardIds: updatedIds.filter((id) => had(id, source)),
        folder: {
          folderId: source,
          folderName: target.fromFolderName ?? "",
        },
      },
    ];
  } else {
    return;
  }
  return steps.filter((step) => step.cardIds.length > 0);
};

type FolderAction = "addToFolder" | "removeFromFolder" | "moveToFolder";

const UNNAMED_FOLDER_DONE = {
  addToFolder: "addToUnnamedFolder",
  removeFromFolder: "removeFromUnnamedFolder",
  moveToFolder: "moveToUnnamedFolder",
} as const satisfies Record<FolderAction, string>;

const isFolderAction = (action: BulkCardAction): action is FolderAction =>
  action in UNNAMED_FOLDER_DONE;

const doneMessage = (
  action: BulkCardAction,
  count: number,
  folder: string | undefined,
  t: BulkCopyTranslator
) => {
  if (!isFolderAction(action)) {
    return t(`done.${action}`, { count });
  }
  return folder
    ? t(`done.${action}`, { count, folder: clipFolderName(folder) })
    : t(`done.${UNNAMED_FOLDER_DONE[action]}`, { count });
};

/**
 * Toast text for a bulk action. A folder action without a folder name says
 * "the folder".
 */
export const bulkActionCopy = {
  progress: (
    action: BulkCardAction,
    done: number,
    total: number,
    t: BulkCopyTranslator
  ) => t(`progress.${action}`, { done, total }),
  done: (
    action: BulkCardAction,
    count: number,
    folder: string | undefined,
    t: BulkCopyTranslator
  ) => doneMessage(action, count, folder, t),
  partial: (
    action: BulkCardAction,
    updated: number,
    failed: number,
    folder: string | undefined,
    t: BulkCopyTranslator
  ) => t("partial", { done: doneMessage(action, updated, folder, t), failed }),
  failed: (action: BulkCardAction, t: BulkCopyTranslator) =>
    t(`failed.${action}`),
};

export interface BulkRunResult {
  failedIds: string[];
  updatedIds: string[];
}

export const runBulkInChunks = async (
  cardIds: readonly string[],
  send: (chunk: string[]) => Promise<BulkRunResult>,
  {
    chunkSize = BULK_CHUNK_SIZE,
    onError,
    onProgress,
  }: {
    chunkSize?: number;
    onError?: (error: unknown) => void;
    onProgress?: (done: number, total: number) => void;
  } = {}
): Promise<BulkRunResult> => {
  const ids = Array.from(new Set(cardIds));
  const updatedIds: string[] = [];
  const failedIds: string[] = [];
  for (let start = 0; start < ids.length; start += chunkSize) {
    const chunk = ids.slice(start, start + chunkSize);
    try {
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
      const result = await send(chunk);
      updatedIds.push(...result.updatedIds);
      failedIds.push(...result.failedIds);
    } catch (error) {
      onError?.(error);
      failedIds.push(...chunk);
    }
    onProgress?.(Math.min(start + chunk.length, ids.length), ids.length);
  }
  return { updatedIds, failedIds };
};

export const collectCardLinks = (cards: readonly Doc<"cards">[]): string[] =>
  Array.from(
    new Set(
      cards
        .map((card) => card.url?.trim())
        .filter((url): url is string => Boolean(url))
    )
  );

/** Whether there are cards and every one is a favorite. */
export const allFavorited = (cards: readonly { isFavorited?: boolean }[]) =>
  cards.length > 0 && cards.every((card) => card.isFavorited === true);
