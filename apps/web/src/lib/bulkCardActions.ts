import type { Doc } from "@teak/convex/_generated/dataModel";
import type { TeakTranslator } from "@teak/i18n";
import { clipFolderName } from "./clipFolderName";
import { englishTranslator } from "./englishTranslators";

export type BulkCopyTranslator = TeakTranslator<"lib.bulkCardActions">;

const englishBulkCopy: BulkCopyTranslator = englishTranslator(
  "lib.bulkCardActions"
);

export type BulkCardAction =
  | "favorite"
  | "unfavorite"
  | "archive"
  | "unarchive"
  | "addTags"
  | "removeTags"
  | "delete"
  | "restore"
  | "addToFolder"
  | "removeFromFolder"
  | "moveToFolder";

export interface BulkFolderTarget {
  folderId: string;
  folderName: string;
  fromFolderId?: string;
  fromFolderName?: string;
}

export const BULK_CHUNK_SIZE = 100;

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
    t: BulkCopyTranslator = englishBulkCopy
  ) => t(`progress.${action}`, { done, total }),
  done: (
    action: BulkCardAction,
    count: number,
    folder?: string,
    t: BulkCopyTranslator = englishBulkCopy
  ) => doneMessage(action, count, folder, t),
  partial: (
    action: BulkCardAction,
    updated: number,
    failed: number,
    folder?: string,
    t: BulkCopyTranslator = englishBulkCopy
  ) => t("partial", { done: doneMessage(action, updated, folder, t), failed }),
  failed: (action: BulkCardAction, t: BulkCopyTranslator = englishBulkCopy) =>
    t(`failed.${action}`),
};

const hasTag = (list: readonly string[], tag: string) =>
  list.some((item) => item.toLowerCase() === tag.toLowerCase());

export const applyBulkActionToCard = (
  card: Doc<"cards">,
  action: BulkCardAction,
  tags: readonly string[] = [],
  now = Date.now(),
  folder?: { folderId: string; fromFolderId?: string }
): Doc<"cards"> => {
  switch (action) {
    case "addToFolder":
    case "removeFromFolder":
    case "moveToFolder": {
      if (!folder) {
        return card;
      }
      const current = (card.folderIds ?? []) as string[];
      let next: string[];
      if (action === "addToFolder") {
        next = current.includes(folder.folderId)
          ? current
          : [...current, folder.folderId];
      } else if (action === "removeFromFolder") {
        next = current.filter((id) => id !== folder.folderId);
      } else {
        const kept = folder.fromFolderId
          ? current.filter((id) => id !== folder.fromFolderId)
          : [];
        next = kept.includes(folder.folderId)
          ? kept
          : [...kept, folder.folderId];
      }
      return next.length === current.length &&
        next.every((id, index) => id === current[index])
        ? card
        : {
            ...card,
            folderIds: (next.length > 0
              ? next
              : undefined) as Doc<"cards">["folderIds"],
            updatedAt: now,
          };
    }
    case "favorite":
    case "unfavorite":
      return {
        ...card,
        isFavorited: action === "favorite",
        updatedAt: now,
      };
    case "archive":
      return card.isArchived
        ? card
        : { ...card, isArchived: true, archivedAt: now, updatedAt: now };
    case "unarchive":
      return card.isArchived
        ? {
            ...card,
            isArchived: undefined,
            archivedAt: undefined,
            updatedAt: now,
          }
        : card;
    case "delete":
      return card.isDeleted
        ? card
        : { ...card, isDeleted: true, deletedAt: now, updatedAt: now };
    case "restore":
      return card.isDeleted
        ? {
            ...card,
            isDeleted: undefined,
            deletedAt: undefined,
            updatedAt: now,
          }
        : card;
    case "addTags": {
      const current = card.tags ?? [];
      const added = tags.filter((tag) => !hasTag(current, tag));
      return added.length > 0
        ? { ...card, tags: [...current, ...added], updatedAt: now }
        : card;
    }
    case "removeTags": {
      const kept = (card.tags ?? []).filter((tag) => !hasTag(tags, tag));
      const keptAi = (card.aiTags ?? []).filter((tag) => !hasTag(tags, tag));
      return {
        ...card,
        tags: kept.length > 0 ? kept : undefined,
        aiTags: keptAi.length > 0 ? keptAi : undefined,
        updatedAt: now,
      };
    }
    default:
      return card;
  }
};

export interface BulkRunResult {
  failedIds: string[];
  updatedIds: string[];
}

export const runBulkInChunks = async (
  cardIds: readonly string[],
  send: (chunk: string[]) => Promise<BulkRunResult>,
  onProgress?: (done: number, total: number) => void,
  chunkSize = BULK_CHUNK_SIZE
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
    } catch {
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
