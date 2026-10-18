import { useEffect, useRef } from "react";

export interface KeyboardShortcut {
  keys: string;
  run: () => void;
  when?: () => boolean;
}

export const SHORTCUT_SEQUENCE_TIMEOUT_MS = 1000;

export const SHORTCUTS_DIALOG_ATTRIBUTE = "data-keyboard-shortcuts-dialog";

const TYPING_ROLES = new Set([
  "combobox",
  "searchbox",
  "spinbutton",
  "textbox",
]);

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (target.closest("[contenteditable]:not([contenteditable='false'])")) {
    return true;
  }
  const role = target.getAttribute("role");
  return role !== null && TYPING_ROLES.has(role);
}

const OVERLAY_SELECTOR = [
  "[role='dialog'][data-state='open']",
  "[role='alertdialog'][data-state='open']",
  "[role='menu'][data-state='open']",
  "[role='listbox'][data-state='open']",
]
  .map((selector) => `${selector}:not([${SHORTCUTS_DIALOG_ATTRIBUTE}])`)
  .join(", ");

export function isOverlayOpen(root: ParentNode = document): boolean {
  return root.querySelector(OVERLAY_SELECTOR) !== null;
}

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
        isTypingTarget(event.target) ||
        isOverlayOpen()
      ) {
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
        (shortcut) => shortcut.when?.() ?? true
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
