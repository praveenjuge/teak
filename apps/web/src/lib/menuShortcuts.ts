import type { KeyboardEvent } from "react";

const DELETE_KEYS = new Set(["backspace", "delete"]);

/**
 * Whether a key press matches an `aria-keyshortcuts` value such as `F`,
 * `Control+C` or `Delete`. Delete and Backspace stand for each other, as they
 * do in the card grid.
 */
export function matchesMenuShortcut(
  keys: string,
  event: Pick<
    globalThis.KeyboardEvent,
    "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
  >
): boolean {
  const parts = keys.split("+");
  const key = parts.at(-1)?.toLowerCase();
  const modifiers = new Set(parts.slice(0, -1));
  if (
    !key ||
    event.altKey !== modifiers.has("Alt") ||
    event.ctrlKey !== modifiers.has("Control") ||
    event.metaKey !== modifiers.has("Meta") ||
    event.shiftKey !== modifiers.has("Shift")
  ) {
    return false;
  }
  const pressed = event.key.toLowerCase();
  return pressed === key || (DELETE_KEYS.has(pressed) && DELETE_KEYS.has(key));
}

/**
 * An open menu holds focus, so the page never hears the shortcuts the menu
 * lists, and the menu's type-to-find takes the letters instead. Every menu
 * runs this on keydown: a key that matches an item's `aria-keyshortcuts`
 * picks that item, which runs it and closes the menu.
 */
export function runMenuItemShortcut(event: KeyboardEvent<HTMLElement>) {
  if (event.defaultPrevented) {
    return;
  }
  const item = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      '[role^="menuitem"][aria-keyshortcuts]'
    )
  ).find((candidate) =>
    matchesMenuShortcut(
      candidate.getAttribute("aria-keyshortcuts") ?? "",
      event
    )
  );
  if (!item) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (!(event.repeat || item.hasAttribute("data-disabled"))) {
    item.click();
  }
}
