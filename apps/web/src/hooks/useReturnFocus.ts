import { useCallback, useRef } from "react";
import type { FinalFocus } from "./useRunAfterClose";

function focusedElement(): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  const focused = document.activeElement;
  return focused instanceof HTMLElement && focused !== document.body
    ? focused
    : null;
}

/**
 * Remembers what had focus when an overlay opened. The returned function is
 * an overlay's `finalFocus`: it gives back that element if it's still on the
 * page, else `fallback`, else `true` for the overlay's own default.
 *
 * Base UI sends focus to the first tabbable element inside a target that is
 * focusable but not tabbable (`tabindex="-1"`, like a dialog's own popup), so
 * such a target is focused here and Base UI is told to leave focus alone.
 */
export function useReturnFocus(open: boolean) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  if (open && !wasOpenRef.current) {
    returnFocusRef.current = focusedElement();
  }
  wasOpenRef.current = open;

  return useCallback((fallback?: HTMLElement | null): FinalFocus => {
    const target = returnFocusRef.current?.isConnected
      ? returnFocusRef.current
      : fallback;
    returnFocusRef.current = null;
    if (target && target.tabIndex < 0) {
      target.focus({ preventScroll: true });
      return false;
    }
    return target ?? true;
  }, []);
}
