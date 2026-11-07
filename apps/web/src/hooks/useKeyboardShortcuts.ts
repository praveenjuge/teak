import { useEffect, useRef } from "react";
import { isTypingTarget, OVERLAY_SELECTOR } from "../lib/keyboardShortcuts";

export interface KeyboardShortcut {
  /**
   * An attribute marking the dialogs this shortcut still works over. With
   * any other overlay open, a menu included, it waits like the rest.
   */
  alsoOver?: string;
  keys: string;
  run: () => void;
  when?: () => boolean;
}

export const SHORTCUT_SEQUENCE_TIMEOUT_MS = 1000;

const openOverlays = (): Element[] =>
  Array.from(document.querySelectorAll(OVERLAY_SELECTOR));

const shortcutKey = (event: KeyboardEvent): string | null => {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }
  const { key } = event;
  if (key.length !== 1) {
    return null;
  }
  const lower = key.toLowerCase();
  if (event.shiftKey && lower !== key.toUpperCase()) {
    return null;
  }
  return lower;
};

export function useKeyboardShortcuts(
  shortcuts: readonly KeyboardShortcut[],
  { enabled = true }: { enabled?: boolean } = {}
) {
  const shortcutsRef = useRef(shortcuts);
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);
  const pendingRef = useRef<{ at: number; key: string } | null>(null);

  useEffect(() => {
    if (!enabled) {
      pendingRef.current = null;
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        isTypingTarget(event.target)
      ) {
        pendingRef.current = null;
        return;
      }
      const overlays = openOverlays();
      const usable = (shortcut: KeyboardShortcut) =>
        overlays.length === 0 ||
        (shortcut.alsoOver !== undefined &&
          overlays.every((overlay) =>
            overlay.hasAttribute(shortcut.alsoOver as string)
          ));
      if (!shortcutsRef.current.some(usable)) {
        pendingRef.current = null;
        return;
      }
      const key = shortcutKey(event);
      if (key === null) {
        pendingRef.current = null;
        return;
      }
      if (event.repeat) {
        return;
      }
      const all = shortcutsRef.current.filter(
        (shortcut) => usable(shortcut) && (shortcut.when?.() ?? true)
      );
      const run = (shortcut: KeyboardShortcut) => {
        event.preventDefault();
        event.stopPropagation();
        shortcut.run();
      };

      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending && Date.now() - pending.at <= SHORTCUT_SEQUENCE_TIMEOUT_MS) {
        const sequence = all.find(
          (shortcut) => shortcut.keys === `${pending.key} ${key}`
        );
        if (sequence) {
          run(sequence);
          return;
        }
      }
      if (all.some((shortcut) => shortcut.keys.startsWith(`${key} `))) {
        pendingRef.current = { at: Date.now(), key };
        event.stopPropagation();
        return;
      }
      const single = all.find((shortcut) => shortcut.keys === key);
      if (single) {
        run(single);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [enabled]);
}
