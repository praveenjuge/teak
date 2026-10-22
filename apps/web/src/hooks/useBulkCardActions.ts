import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { UNDO_TOAST_DURATION_MS } from "../constants/toast";
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
import { updateCardsInSearchQueries } from "../lib/cardQueryOptimisticUpdates";

export interface BulkActionOptions {
  folder?: BulkFolderTarget;
  priorFolderIds?: ReadonlyMap<string, readonly string[]>;
  silent?: boolean;
  tags?: string[];
}

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
            ...(undoSteps?.length
              ? {
                  action: {
                    label: "Undo",
                    onClick: () => {
                      runUndo(undoSteps).catch(() => undefined);
                    },
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
