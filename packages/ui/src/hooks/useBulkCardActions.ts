import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  applyBulkActionToCard,
  type BulkCardAction,
  type BulkFolderTarget,
  type BulkRunResult,
  type BulkUndoStep,
  bulkActionCopy,
  folderUndoSteps,
  runBulkInChunks,
  UNDO_BULK_ACTION,
} from "../lib/bulkCardActions";
import { updateCardsInSearchQueries } from "./cardQueryOptimisticUpdates";

export interface BulkActionOptions {
  folder?: BulkFolderTarget;
  /**
   * For folder actions: the folders each card was in before, by card ID, so
   * Undo puts back exactly what changed.
   */
  priorFolderIds?: ReadonlyMap<string, readonly string[]>;
  /** Skip the progress and success toasts (errors still show). */
  silent?: boolean;
  tags?: string[];
}

/**
 * Runs bulk bar actions on any number of cards: the grid updates at once,
 * the server work goes in chunks of 100 with one progress toast, and the
 * result toast offers Undo (archive, unarchive, delete) or Retry for cards
 * that couldn't be changed. Resolves with the cards that failed.
 */
export function useBulkCardActions(toastIdPrefix = "cards") {
  const bulkUpdate = useMutation(
    api.cards.bulkUpdateCards
  ).withOptimisticUpdate(
    (localStore, { cardIds, action, tags, folderId, fromFolderId }) => {
      const now = Date.now();
      updateCardsInSearchQueries(localStore, new Set(cardIds), (card) =>
        applyBulkActionToCard(
          card,
          action,
          tags,
          now,
          folderId ? { folderId, fromFolderId } : undefined
        )
      );
    }
  );

  const runCount = useRef(0);

  const run = useCallback(
    async (
      action: BulkCardAction,
      cardIds: string[],
      options: BulkActionOptions = {}
    ): Promise<BulkRunResult> => {
      runCount.current += 1;
      const toastId = `${toastIdPrefix}-bulk-${runCount.current}`;
      const total = new Set(cardIds).size;
      if (total > 1 && !options.silent) {
        toast.loading(bulkActionCopy.progress(action, 0, total), {
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
        (done, count) => {
          if (count > 1 && done < count && !options.silent) {
            toast.loading(bulkActionCopy.progress(action, done, count), {
              id: toastId,
            });
          }
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
      const runUndo = async (steps: BulkUndoStep[]) => {
        for (const [index, step] of steps.entries()) {
          // Steps run in order; only the last one reports, so a move's Undo
          // shows one toast.
          // react-doctor-disable-next-line react-doctor/async-await-in-loop
          await run(step.action, step.cardIds, {
            folder: step.folder,
            silent: index < steps.length - 1,
          });
        }
      };
      if (failedIds.length === 0) {
        if (options.silent) {
          return result;
        }
        toast.success(
          bulkActionCopy.done(action, updatedIds.length, folderName),
          {
            id: toastId,
            action: undoSteps?.length
              ? {
                  label: "Undo",
                  onClick: () => {
                    runUndo(undoSteps).catch(() => undefined);
                  },
                }
              : undefined,
          }
        );
      } else {
        toast.error(
          updatedIds.length > 0
            ? bulkActionCopy.partial(
                action,
                updatedIds.length,
                failedIds.length,
                folderName
              )
            : bulkActionCopy.failed(action),
          {
            id: toastId,
            action: {
              label: "Retry",
              onClick: () => {
                run(action, failedIds, options).catch(() => undefined);
              },
            },
          }
        );
      }
      return result;
    },
    [bulkUpdate, toastIdPrefix]
  );

  return run;
}
