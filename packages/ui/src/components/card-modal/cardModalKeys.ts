import { isTypingTarget } from "../../hooks/useKeyboardShortcuts";
import { isApplePlatform } from "../../lib/platform";

export type CardModalKeyAction =
  | "previous"
  | "next"
  | "favorite"
  | "archive"
  | "delete"
  | "focusTags"
  | "focusNotes";

const KEY_ACTIONS: Record<string, CardModalKeyAction> = {
  ArrowLeft: "previous",
  ArrowRight: "next",
  k: "previous",
  j: "next",
  f: "favorite",
  e: "archive",
  t: "focusTags",
  n: "focusNotes",
  Delete: "delete",
};

/**
 * What a key pressed in the open card dialog does, or null when it is
 * someone typing, a media control, a held repeat or a modified key.
 * Backspace deletes only on Apple platforms, where it is the Delete key (⌫).
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
  if (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.isComposing ||
    isTypingTarget(event.target)
  ) {
    return null;
  }
  // Arrow keys seek a focused video or audio player.
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
  // Holding an arrow walks through cards; holding a letter does nothing more.
  if (event.repeat && action !== "previous" && action !== "next") {
    return null;
  }
  return action;
}
