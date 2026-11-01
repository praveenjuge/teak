import { useTranslations } from "@teak/i18n/react";
import { useCallback, useEffect, useState } from "react";
import {
  isOverlayOpen,
  isTypingTarget,
} from "../../hooks/useKeyboardShortcuts";
import { isSelectAllKey } from "../../lib/gridKeys";
import { ConfirmDialog } from "../ui/confirm-dialog";

/**
 * In selection mode ⌘A / Ctrl+A picks every card shown instead of the
 * page's text.
 */
export function useSelectAllCards(
  isSelectionMode: boolean,
  cardIds: readonly string[],
  select: (cardIds: Set<string>) => void
) {
  useEffect(() => {
    if (!isSelectionMode) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !isSelectAllKey(event) ||
        event.defaultPrevented ||
        isTypingTarget(event.target) ||
        isOverlayOpen()
      ) {
        return;
      }
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      select(new Set(cardIds));
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cardIds, isSelectionMode, select]);
}

/**
 * "Delete forever" for the cards selected in Trash: asks first, naming how
 * many, then deletes them all.
 */
/**
 * Asks before deleting the selected cards forever. When `onConfirm` reports
 * cards it couldn't delete, `onFailed` gets them, to keep them selected.
 */
export function useBulkDeleteForever(
  onConfirm: (
    cardIds: string[]
  ) => Promise<{ failedIds: readonly string[] }> | undefined,
  onFailed: (...failedIds: string[]) => void
) {
  const tDialog = useTranslations("cards.deleteForeverDialog");
  // Kept after closing, so the dialog's count holds while it fades out.
  const [cardIds, setCardIds] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  const request = useCallback((ids: string[]) => {
    if (ids.length > 0) {
      setCardIds(ids);
      setOpen(true);
    }
  }, []);

  const dialog = (
    <ConfirmDialog
      confirmLabel={tDialog("confirm")}
      description={tDialog("bulkDescription", { count: cardIds.length })}
      onConfirm={() => {
        setOpen(false);
        onConfirm(cardIds)
          ?.then(({ failedIds }) => {
            if (failedIds.length > 0) {
              onFailed(...failedIds);
            }
          })
          .catch(() => undefined);
      }}
      onOpenChange={setOpen}
      open={open}
      title={tDialog("bulkTitle", { count: cardIds.length })}
    />
  );

  return { dialog, request };
}
