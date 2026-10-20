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

export function useReturnFocus(open: boolean) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  if (open && !wasOpenRef.current) {
    returnFocusRef.current = focusedElement();
  }
  wasOpenRef.current = open;

  return useCallback((event: Event, fallback?: HTMLElement | null) => {
    const target = returnFocusRef.current?.isConnected
      ? returnFocusRef.current
      : fallback;
    returnFocusRef.current = null;
    if (target) {
      event.preventDefault();
      target.focus({ preventScroll: true });
    }
  }, []);
}
