import { useCallback, useRef } from "react";

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
 */
export function useReturnFocus(open: boolean) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  if (open && !wasOpenRef.current) {
    returnFocusRef.current = focusedElement();
  }
  wasOpenRef.current = open;

  return useCallback((fallback?: HTMLElement | null): HTMLElement | true => {
    const target = returnFocusRef.current?.isConnected
      ? returnFocusRef.current
      : fallback;
    returnFocusRef.current = null;
    return target ?? true;
  }, []);
}
