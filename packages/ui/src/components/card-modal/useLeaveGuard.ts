import { useCallback, useEffect, useRef } from "react";

/**
 * Guards closing the card dialog or moving to another card. Leaving saves
 * pending edits first; if that save fails, the card stays open so the edit
 * can be saved again, and a second try leaves anyway, so an error that never
 * clears (an expired session, a card deleted elsewhere) can't trap anyone.
 *
 * Only a failed save made while leaving counts. A background autosave that
 * failed earlier doesn't, so the first try to leave always saves first.
 */
export function useLeaveGuard({
  cardId,
  hasUnsavedChanges,
  saveChanges,
}: {
  cardId?: string | null;
  hasUnsavedChanges: boolean;
  saveChanges: (options: { silent: boolean }) => Promise<boolean>;
}) {
  const failedLeaveRef = useRef<{ cardId?: string | null } | null>(null);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      failedLeaveRef.current = null;
    }
  }, [hasUnsavedChanges]);

  /** Call on every edit, so a changed edit is saved again before leaving. */
  const noteEdit = useCallback(() => {
    failedLeaveRef.current = null;
  }, []);

  /** Whether the dialog may now close or show another card. */
  const readyToLeave = useCallback(async () => {
    if (!hasUnsavedChanges || failedLeaveRef.current?.cardId === cardId) {
      return true;
    }
    const saved = await saveChanges({ silent: true });
    failedLeaveRef.current = saved ? null : { cardId };
    return saved;
  }, [cardId, hasUnsavedChanges, saveChanges]);

  return { noteEdit, readyToLeave };
}
