import { useCallback, useRef } from "react";

/**
 * Runs something once an overlay (a dialog, a menu, the command palette)
 * has closed, instead of giving focus back to what had it before. While an
 * overlay's focus trap is up, moving focus (to the search box, the
 * composer, another dialog) is pulled back into it, and a closing overlay
 * then focuses its trigger over whatever the action focused.
 *
 * Pass `onCloseAutoFocus` to the overlay's content; `runAfterClose` queues
 * the action, then close the overlay. Without a queued action, focus goes
 * where `returnFocus` sends it, or the overlay's default.
 */
export function useRunAfterClose(returnFocus?: (event: Event) => void) {
  const pendingRef = useRef<(() => void) | null>(null);

  const runAfterClose = useCallback((action: () => void) => {
    pendingRef.current = action;
  }, []);

  const onCloseAutoFocus = useCallback(
    (event: Event) => {
      const action = pendingRef.current;
      pendingRef.current = null;
      if (action) {
        event.preventDefault();
        action();
        return;
      }
      returnFocus?.(event);
    },
    [returnFocus]
  );

  return { onCloseAutoFocus, runAfterClose };
}
