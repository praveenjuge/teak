import { useEffect, useRef } from "react";

export interface KeyboardShortcut {
  /** One key (`"/"`, `"n"`, `"?"`) or a two-key sequence (`"g f"`). */
  keys: string;
  run: () => void;
  /** Only while this holds; otherwise the key is left alone. */
  when?: () => boolean;
}

/** How long the second key of a sequence (`g` then `f`) may wait. */
export const SHORTCUT_SEQUENCE_TIMEOUT_MS = 1000;

/** Marks the one dialog shortcuts still work in: the shortcuts list. */
export const SHORTCUTS_DIALOG_ATTRIBUTE = "data-keyboard-shortcuts-dialog";

const TYPING_ROLES = new Set([
  "combobox",
  "searchbox",
  "spinbutton",
  "textbox",
]);

/** Whether keys pressed here are typing: a field, editor or text control. */
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

/**
 * Whether a dialog, menu or popup list is open (other than the shortcuts
 * dialog): its keys belong to it, so app shortcuts stay quiet.
 */
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

/**
 * App-wide single-key shortcuts and `g`-style sequences, on one `keydown`
 * listener on the document. Nothing fires while typing in a field or
 * editor, with a modifier held (Shift aside, for `?`), on a held-down
 * repeat, or while a dialog or menu other than the shortcuts list is open.
 *
 * It listens in the capture phase so a sequence's second key (the `f` of
 * `g f`) is taken before a focused card can treat it as its own shortcut.
 */
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
