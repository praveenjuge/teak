import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import {
  type CardPinSource,
  captureEvent,
} from "@teak/convex/shared/analytics";
import type { BulkCardAction } from "@teak/convex/shared/bulkCardActions";
import { captureClientException } from "@teak/convex/shared/clientTelemetry";
import { doneActionLabel } from "@teak/convex/shared/linkCategories";
import { MAX_PINNED_CARDS } from "@teak/convex/shared/pins";
import { useTranslations } from "@teak/i18n/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { UNDO_TOAST_DURATION_MS } from "../constants/toast";
import {
  allFavorited,
  type BulkFolderTarget,
  type BulkRunResult,
  type BulkUndoStep,
  bulkActionCopy,
  folderUndoSteps,
  runBulkInChunks,
  UNDO_BULK_ACTION,
} from "../lib/bulkCardActions";
import type { CardActionId } from "../lib/cardActions";
import {
  isPinLimitError,
  isPinned,
  restoredPinOrder,
} from "../lib/pinnedCards";
import {
  useBulkUpdateCards,
  usePermanentDeleteCard,
  useReorderPinnedCards,
  useSetCardPinned,
  useUpdateCardField,
} from "./useCardMutations";
import { usePinnedCards } from "./usePinnedCards";

export interface BulkActionOptions {
  folder?: BulkFolderTarget;
  priorFolderIds?: ReadonlyMap<string, readonly string[]>;
  /** No progress or success toast: the card on screen shows the change. */
  silent?: boolean;
  tags?: string[];
}

export interface BulkDeleteResult {
  deletedCount: number;
  failedIds: Id<"cards">[];
  requestedCount: number;
}

type ActionTarget = Pick<
  Doc<"cards">,
  "_id" | "isArchived" | "isFavorited" | "pinPosition"
>;

type DoneTarget = Pick<Doc<"cards">, "_id" | "completedAt" | "metadata">;

/** Archiving or trashing a card unpins it; their Undo pins it again. */
const UNPINNING_ACTIONS: ReadonlySet<BulkCardAction> = new Set([
  "archive",
  "delete",
]);

const succeeded = (run: Promise<BulkRunResult>) =>
  run.then(({ failedIds }) => failedIds.length === 0);

let toastCount = 0;
const nextToastId = () => {
  toastCount += 1;
  return `card-action-${toastCount}`;
};

/**
 * Runs the card actions `lib/cardActions` lists, the same way from every
 * surface: one mutation each, its optimistic update, its toast and Undo, and
 * the analytics event the action has.
 */
export function useCardActions() {
  const bulkUpdate = useBulkUpdateCards();
  const updateCardField = useUpdateCardField();
  const permanentDeleteCard = usePermanentDeleteCard();
  const setCardPinned = useSetCardPinned();
  const t = useTranslations("lib.bulkCardActions");
  const tActions = useTranslations("hooks.cardActions");
  const tPins = useTranslations("hooks.pinnedCards");
  const tc = useTranslations("common");
  const reorderPinnedCards = useReorderPinnedCards();
  const pinned = usePinnedCards();
  const pinnedRef = useRef(pinned);
  useEffect(() => {
    pinnedRef.current = pinned;
  }, [pinned]);

  /**
   * Pins `cardIds` again where they were in `before`, the pinned row as it
   * was when an archive or trash unpinned them.
   */
  const restorePins = useCallback(
    async (before: readonly string[], cardIds: readonly string[]) => {
      const restoring = new Set(cardIds);
      const current = pinnedRef.current
        ?.map((card) => card._id as string)
        .filter((id) => !restoring.has(id));
      try {
        // A new pin goes first, so the last one goes back first.
        for (const cardId of [...cardIds].reverse()) {
          // react-doctor-disable-next-line react-doctor/async-await-in-loop
          await setCardPinned({ cardId: cardId as Id<"cards">, pinned: true });
        }
        if (current) {
          await reorderPinnedCards({
            cardIds: restoredPinOrder(
              current,
              before,
              cardIds
            ) as Id<"cards">[],
          });
        }
      } catch (error) {
        if (isPinLimitError(error)) {
          toast.error(tPins("limit", { count: MAX_PINNED_CARDS }));
          return;
        }
        captureClientException(error, { operation: "card.restore_pins" });
        toast.error(tPins("failed.pin"));
      }
    },
    [reorderPinnedCards, setCardPinned, tPins]
  );

  const runBulk = useCallback(
    async (
      action: BulkCardAction,
      cardIds: string[],
      options: BulkActionOptions = {}
    ): Promise<BulkRunResult> => {
      const toastId = nextToastId();
      const total = new Set(cardIds).size;
      const pinsBefore = UNPINNING_ACTIONS.has(action)
        ? (pinnedRef.current ?? []).map((card) => card._id as string)
        : [];
      if (total > 1 && !options.silent) {
        toast.loading(bulkActionCopy.progress(action, 0, total, t), {
          id: toastId,
        });
      }

      const result = await runBulkInChunks(
        cardIds,
        (chunk) =>
          bulkUpdate({
            cardIds: chunk as Id<"cards">[],
            action,
            tags: options.tags,
            ...(options.folder
              ? {
                  folderId: options.folder.folderId as Id<"folders">,
                  ...(options.folder.fromFolderId
                    ? {
                        fromFolderId: options.folder
                          .fromFolderId as Id<"folders">,
                      }
                    : {}),
                }
              : {}),
          }),
        {
          onError: (error) =>
            captureClientException(error, { operation: `card.bulk.${action}` }),
          onProgress: (done, count) => {
            if (count > 1 && done < count && !options.silent) {
              toast.loading(bulkActionCopy.progress(action, done, count, t), {
                id: toastId,
              });
            }
          },
        }
      );

      const { updatedIds, failedIds } = result;
      const folderName = options.folder?.folderName;
      const plainUndo = UNDO_BULK_ACTION[action];
      let undoSteps: BulkUndoStep[] | undefined;
      if (options.folder) {
        undoSteps = folderUndoSteps(
          action,
          options.folder,
          updatedIds,
          options.priorFolderIds ?? new Map()
        );
      } else if (plainUndo) {
        undoSteps = [{ action: plainUndo, cardIds: updatedIds }];
      }
      const updated = new Set<string>(updatedIds);
      const unpinned = pinsBefore.filter((id) => updated.has(id));
      const runUndo = async (steps: BulkUndoStep[]) => {
        const undone = new Set<string>();
        for (const [index, step] of steps.entries()) {
          // react-doctor-disable-next-line react-doctor/async-await-in-loop
          const stepResult = await runBulk(step.action, step.cardIds, {
            folder: step.folder,
            silent: index < steps.length - 1,
          });
          for (const id of stepResult.updatedIds) {
            undone.add(id);
          }
        }
        const repin = unpinned.filter((id) => undone.has(id));
        if (repin.length > 0) {
          await restorePins(pinsBefore, repin);
        }
      };
      if (failedIds.length === 0) {
        if (options.silent) {
          return result;
        }
        toast.success(
          bulkActionCopy.done(action, updatedIds.length, folderName, t),
          {
            id: toastId,
            ...(undoSteps?.length
              ? {
                  action: {
                    label: tc("undo"),
                    onClick: () => void runUndo(undoSteps),
                  },
                  duration: UNDO_TOAST_DURATION_MS,
                }
              : {}),
          }
        );
      } else {
        toast.error(
          updatedIds.length > 0
            ? bulkActionCopy.partial(
                action,
                updatedIds.length,
                failedIds.length,
                folderName,
                t
              )
            : bulkActionCopy.failed(action, t),
          {
            id: toastId,
            action: {
              label: tc("retry"),
              onClick: () => void runBulk(action, failedIds, options),
            },
          }
        );
      }
      return result;
    },
    [bulkUpdate, restorePins, t, tc]
  );

  /** Deletes cards in Trash forever, with one toast for all. */
  const deleteForever = useCallback(
    async (cardIds: string[]): Promise<BulkDeleteResult> => {
      const failedIds: Id<"cards">[] = [];
      let deletedCount = 0;
      for (const cardId of cardIds) {
        try {
          // react-doctor-disable-next-line react-doctor/async-await-in-loop
          await permanentDeleteCard({ id: cardId as Id<"cards"> });
          deletedCount += 1;
        } catch (error) {
          captureClientException(error, {
            operation: "card.permanent_delete",
          });
          failedIds.push(cardId as Id<"cards">);
        }
      }
      if (deletedCount > 0) {
        toast(tActions("cardsPermanentlyDeleted", { count: deletedCount }));
      }
      if (failedIds.length > 0) {
        toast.error(tActions("permanentDeleteFailed"));
      }
      return { deletedCount, failedIds, requestedCount: cardIds.length };
    },
    [permanentDeleteCard, tActions]
  );

  /**
   * `source` is where the person pinned it, for `card_pin_toggled`; a pin
   * from no surface the event catalog names sends no event.
   */
  const togglePin = useCallback(
    async (
      card: Pick<ActionTarget, "_id" | "pinPosition">,
      source?: CardPinSource
    ) => {
      const pinned = !isPinned(card);
      try {
        await setCardPinned({ cardId: card._id, pinned });
        if (source) {
          captureEvent("card_pin_toggled", { pinned, source });
        }
      } catch (error) {
        if (isPinLimitError(error)) {
          toast.error(tPins("limit", { count: MAX_PINNED_CARDS }));
          return;
        }
        captureClientException(error, { operation: "card.pin" });
        toast.error(tPins(pinned ? "failed.pin" : "failed.unpin"));
      }
    },
    [setCardPinned, tPins]
  );

  const setDone = useCallback(
    async (card: DoneTarget, done: boolean, { isUndo = false } = {}) => {
      const category = card.metadata?.linkCategory?.category;
      const verb = doneActionLabel(category);
      try {
        await updateCardField({
          cardId: card._id,
          field: done ? "done" : "undone",
        });
      } catch (error) {
        captureClientException(error, { operation: "card.done" });
        toast.error(tActions("doneUpdateFailed"));
        return;
      }
      captureEvent("card_done_toggled", {
        category: category ?? "none",
        done,
        source: "panel",
      });
      if (!isUndo) {
        toast.success(
          tActions(done ? "markedDone" : "markedNotDone", { verb }),
          {
            duration: UNDO_TOAST_DURATION_MS,
            action: {
              label: tc("undo"),
              onClick: () => void setDone(card, !done, { isUndo: true }),
            },
          }
        );
      }
    },
    [tActions, tc, updateCardField]
  );

  return useMemo(() => {
    const toggleFavorite = (cards: ActionTarget[]) =>
      runBulk(
        allFavorited(cards) ? "unfavorite" : "favorite",
        cards.map((card) => card._id),
        { silent: cards.length === 1 }
      );
    const toggleArchive = (card: ActionTarget) =>
      succeeded(runBulk(card.isArchived ? "unarchive" : "archive", [card._id]));
    const moveToTrash = (cardIds: string[]) =>
      succeeded(runBulk("delete", cardIds));
    const restore = (cardIds: string[]) =>
      succeeded(runBulk("restore", cardIds));
    /**
     * Runs one action on one card; true once it has happened. `source` is
     * where it was asked for, for the analytics event the action has.
     */
    const run = async (
      id: RunnableCardActionId,
      card: ActionTarget & DoneTarget,
      source?: CardPinSource
    ): Promise<boolean> => {
      switch (id) {
        case "favorite":
          return succeeded(toggleFavorite([card]));
        case "pin":
          await togglePin(card, source);
          return true;
        case "archive":
          return toggleArchive(card);
        case "moveToTrash":
          return moveToTrash([card._id]);
        case "restore":
          return restore([card._id]);
        case "deleteForever":
          return (await deleteForever([card._id])).failedIds.length === 0;
        case "done":
          await setDone(card, card.completedAt === undefined);
          return true;
        default:
          return id satisfies never;
      }
    };
    return {
      deleteForever,
      runBulk,
      setDone,
      togglePin,
      moveToTrash,
      restore,
      run,
    };
  }, [deleteForever, runBulk, setDone, togglePin]);
}

/** Runs a bulk action on cards, with its toasts and Undo. */
export type RunBulkCardAction = ReturnType<typeof useCardActions>["runBulk"];

/** Where a grid card's action was asked for: its menu, or its key. */
export type CardGridSource = Extract<CardPinSource, "grid" | "shortcut">;

/** The actions the runner does itself; a surface handles the rest. */
export type RunnableCardActionId = Exclude<
  CardActionId,
  "addTags" | "copy" | "select"
>;

/** What a grid hands up: it selects cards and confirms deletes itself. */
export type GridCardAction = Exclude<CardActionId, "copy" | "done" | "select">;
