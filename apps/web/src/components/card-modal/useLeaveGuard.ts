import { useCallback, useEffect, useRef } from "react";

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

  const noteEdit = useCallback(() => {
    failedLeaveRef.current = null;
  }, []);

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
