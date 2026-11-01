import type { PointerEvent } from "react";

/**
 * How long after a context menu opens a pointer release is still treated as
 * the end of the press that opened it.
 */
export const CONTEXT_MENU_RELEASE_GRACE_MS = 300;

const SECONDARY_BUTTON = 2;

let lastOpenedAt: number | null = null;

const now = () =>
  typeof performance === "undefined" ? Date.now() : performance.now();

/** Notes that a context menu just opened, from its trigger's `contextmenu`. */
export function markContextMenuOpened(at: number = now()) {
  lastOpenedAt = at;
}

/**
 * Whether a pointer release over a menu item belongs to the press that opened
 * the menu rather than to a choice. On macOS and Linux `contextmenu` fires on
 * mouse-down, and when the menu shifts to fit the viewport an item can land
 * under the pointer, so releasing the button would run it unseen.
 */
export function isMenuOpeningRelease(
  release: { button: number; at?: number },
  openedAt: number | null = lastOpenedAt
): boolean {
  if (release.button === SECONDARY_BUTTON) {
    return true;
  }
  if (openedAt === null) {
    return false;
  }
  const elapsed = (release.at ?? now()) - openedAt;
  return elapsed >= 0 && elapsed < CONTEXT_MENU_RELEASE_GRACE_MS;
}

/**
 * Runs on every context menu item's `pointerup` before Radix's own handler,
 * which clicks the item when the press didn't start on it. Preventing the
 * default skips that click, so the release that opened the menu never picks
 * an item; a real click (press and release on the item) still does.
 */
export function ignoreMenuOpeningRelease(event: PointerEvent<HTMLElement>) {
  if (isMenuOpeningRelease({ button: event.button })) {
    event.preventDefault();
  }
}

export function resetContextMenuReleaseForTests() {
  lastOpenedAt = null;
}
