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
  const leaveFailedRef = useRef(false);

  // A new card, or no edits left to save, starts over.
  useEffect(() => {
    if (!hasUnsavedChanges) {
      leaveFailedRef.current = false;
    }
  }, [hasUnsavedChanges]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: resets when the card changes
  useEffect(() => {
    leaveFailedRef.current = false;
  }, [cardId]);

  /** Call on every edit, so a changed edit is saved again before leaving. */
  const noteEdit = useCallback(() => {
    leaveFailedRef.current = false;
  }, []);

  /** Whether the dialog may now close or show another card. */
  const readyToLeave = useCallback(async () => {
    if (!hasUnsavedChanges || leaveFailedRef.current) {
      return true;
    }
    const saved = await saveChanges({ silent: true });
    leaveFailedRef.current = !saved;
    return saved;
  }, [hasUnsavedChanges, saveChanges]);

  return { noteEdit, readyToLeave };
}
