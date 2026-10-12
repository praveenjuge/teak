import { useSyncExternalStore } from "react";

/**
 * Tracks whether a bulk-action bar is on screen, so the toaster can sit above
 * it instead of covering it.
 */

// The bar sits 16px from the bottom and is about 58px tall; keep a small gap.
export const BULK_ACTION_BAR_TOAST_OFFSET_PX = 88;

let visibleBars = 0;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) {
    listener();
  }
};

/** Marks a bar as visible. Returns the cleanup that marks it hidden again. */
export function registerBulkActionBar(): () => void {
  visibleBars += 1;
  notify();
  let registered = true;
  return () => {
    if (!registered) {
      return;
    }
    registered = false;
    visibleBars -= 1;
    notify();
  };
}

export function isBulkActionBarVisible(): boolean {
  return visibleBars > 0;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useIsBulkActionBarVisible(): boolean {
  return useSyncExternalStore(subscribe, isBulkActionBarVisible, () => false);
}

/** Bottom offset for bottom-positioned toasts, in pixels. */
export function getToasterBottomOffset(isBulkBarVisible: boolean): number {
  return isBulkBarVisible ? BULK_ACTION_BAR_TOAST_OFFSET_PX : 0;
}
