import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

export const EMPTY_CONTENT_TOAST_ID = "card-empty-content";

export function useLeaveGuard({
  cardId,
  discardNotice,
  hasUnsavedChanges,
  saveChanges,
}: {
  cardId?: string | null;
  /**
   * Said once the card is left with an edit that isn't saved on purpose,
   * like a note emptied of everything (an empty note isn't saved).
   */
  discardNotice?: string | null;
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
    let ready = true;
    if (hasUnsavedChanges && failedLeaveRef.current?.cardId !== cardId) {
      ready = await saveChanges({ silent: true });
      failedLeaveRef.current = ready ? null : { cardId };
    }
    if (ready && discardNotice) {
      toast(discardNotice, { id: EMPTY_CONTENT_TOAST_ID });
    }
    return ready;
  }, [cardId, discardNotice, hasUnsavedChanges, saveChanges]);

  return { noteEdit, readyToLeave };
}
