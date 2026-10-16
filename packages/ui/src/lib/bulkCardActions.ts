import type { Doc } from "@teak/convex/_generated/dataModel";

/** The actions the bulk bar runs, matching `api.cards.bulkUpdateCards`. */
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

/** The folder a folder action targets, and for a move the one it leaves. */
export interface BulkFolderTarget {
  folderId: string;
  /** Shown in the toasts: "Added 3 cards to Reading". */
  folderName: string;
  fromFolderId?: string;
  fromFolderName?: string;
}

/** Cards per server call; larger selections run in sequential chunks. */
export const BULK_CHUNK_SIZE = 100;

export const cardCountLabel = (count: number) =>
  `${count} card${count === 1 ? "" : "s"}`;

/** The action that puts cards back, for the actions whose toast offers Undo. */
export const UNDO_BULK_ACTION: Partial<Record<BulkCardAction, BulkCardAction>> =
  {
    archive: "unarchive",
    unarchive: "archive",
    delete: "restore",
  };

/** One step of an Undo: an action on some of the cards. */
export interface BulkUndoStep {
  action: BulkCardAction;
  cardIds: string[];
  folder?: BulkFolderTarget;
}

/**
 * The steps that put each card's folders back the way they were, from the
 * folders each card was in before the action (`before`, by card ID). Cards
 * the action left as they were need nothing: adding a card already in the
 * folder must not take it out on Undo, and moving a card that was already in
 * the destination only puts back the folder it left. A move out of every
 * folder has no way back, so it offers no Undo (undefined).
 */
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
          folderName: target.fromFolderName ?? "the folder",
        },
      },
    ];
  } else {
    return;
  }
  return steps.filter((step) => step.cardIds.length > 0);
};

const COPY: Record<
  BulkCardAction,
  {
    running: string;
    done: (cards: string, folder: string) => string;
    failed: string;
  }
> = {
  favorite: {
    running: "Adding to favorites",
    done: (cards) => `Added ${cards} to favorites`,
    failed: "add these cards to favorites",
  },
  unfavorite: {
    running: "Removing from favorites",
    done: (cards) => `Removed ${cards} from favorites`,
    failed: "remove these cards from favorites",
  },
  archive: {
    running: "Archiving",
    done: (cards) => `Archived ${cards}`,
    failed: "archive these cards",
  },
  unarchive: {
    running: "Returning to the library",
    done: (cards) => `Returned ${cards} to the library`,
    failed: "unarchive these cards",
  },
  addTags: {
    running: "Adding tags to",
    done: (cards) => `Added tags to ${cards}`,
    failed: "add tags to these cards",
  },
  removeTags: {
    running: "Removing tags from",
    done: (cards) => `Removed tags from ${cards}`,
    failed: "remove tags from these cards",
  },
  delete: {
    running: "Moving to Trash",
    done: (cards) => `Moved ${cards} to Trash`,
    failed: "move these cards to Trash",
  },
  restore: {
    running: "Restoring",
    done: (cards) => `Restored ${cards}`,
    failed: "restore these cards",
  },
  addToFolder: {
    running: "Adding to the folder",
    done: (cards, folder) => `Added ${cards} to ${folder}`,
    failed: "add these cards to the folder",
  },
  removeFromFolder: {
    running: "Removing from the folder",
    done: (cards, folder) => `Removed ${cards} from ${folder}`,
    failed: "remove these cards from the folder",
  },
  moveToFolder: {
    running: "Moving",
    done: (cards, folder) => `Moved ${cards} to ${folder}`,
    failed: "move these cards",
  },
};

/** What the toasts say: "Archiving 120 of 300…", "Archived 300 cards". */
export const bulkActionCopy = {
  progress: (action: BulkCardAction, done: number, total: number) =>
    `${COPY[action].running} ${done} of ${total}…`,
  done: (action: BulkCardAction, count: number, folder = "the folder") =>
    COPY[action].done(cardCountLabel(count), folder),
  partial: (
    action: BulkCardAction,
    updated: number,
    failed: number,
    folder = "the folder"
  ) =>
    `${COPY[action].done(cardCountLabel(updated), folder)}. ${failed} couldn't be changed.`,
  failed: (action: BulkCardAction) => `Couldn't ${COPY[action].failed}`,
};

const hasTag = (list: readonly string[], tag: string) =>
  list.some((item) => item.toLowerCase() === tag.toLowerCase());

/**
 * The card as the action leaves it, for the optimistic update while the
 * server call runs. Mirrors the server: tags match ignoring case, and Remove
 * tags also clears tags Teak added.
 */
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

/**
 * Sends the cards in chunks of BULK_CHUNK_SIZE, one after another, and
 * collects which ones changed. A chunk whose call fails outright counts all
 * its cards as failed; the run carries on with the next chunk.
 */
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
      // Sequential on purpose: one call at a time keeps the server's write
      // load flat and the progress count honest.
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

/** The links in a selection, one per line, for Copy links. */
export const collectCardLinks = (cards: readonly Doc<"cards">[]): string[] =>
  Array.from(
    new Set(
      cards
        .map((card) => card.url?.trim())
        .filter((url): url is string => Boolean(url))
    )
  );
