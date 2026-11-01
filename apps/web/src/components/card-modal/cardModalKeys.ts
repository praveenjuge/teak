import { isTypingTarget } from "../../hooks/useKeyboardShortcuts";
import { isApplePlatform } from "../../lib/platform";

export type CardModalKeyAction =
  | "previous"
  | "next"
  | "favorite"
  | "archive"
  | "delete"
  | "focusTags"
  | "focusNotes"
  | "done"
  | "open"
  | "copy"
  | "toggleReader"
  | "highlight";

const KEY_ACTIONS: Record<string, CardModalKeyAction> = {
  ArrowLeft: "previous",
  ArrowRight: "next",
  k: "previous",
  j: "next",
  f: "favorite",
  e: "archive",
  t: "focusTags",
  n: "focusNotes",
  d: "done",
  o: "open",
  c: "copy",
  r: "toggleReader",
  h: "highlight",
  Delete: "delete",
};

/**
 * On Apple platforms Backspace is the Delete key (⌫). ⌘↵ (Ctrl+Enter
 * elsewhere) opens the card, except in a field, where it saves.
 */
export function cardModalKeyAction(
  event: {
    altKey: boolean;
    ctrlKey: boolean;
    isComposing?: boolean;
    key: string;
    metaKey: boolean;
    repeat?: boolean;
    shiftKey: boolean;
    target: EventTarget | null;
  },
  apple = isApplePlatform()
): CardModalKeyAction | null {
  if (event.isComposing || isTypingTarget(event.target)) {
    return null;
  }
  if (
    event.key === "Enter" &&
    (apple
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey) &&
    !(event.altKey || event.shiftKey || event.repeat)
  ) {
    return "open";
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return null;
  }
  if (
    event.target instanceof Element &&
    event.target.closest("video, audio, iframe, [role='slider'], [role='menu']")
  ) {
    return null;
  }
  const action =
    apple && event.key === "Backspace"
      ? "delete"
      : KEY_ACTIONS[
          event.key.length === 1 ? event.key.toLowerCase() : event.key
        ];
  if (!action) {
    return null;
  }
  if (event.repeat && action !== "previous" && action !== "next") {
    return null;
  }
  return action;
}
