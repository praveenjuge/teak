import { type CardActionId, cardActionsForKey } from "../../lib/cardActions";
import {
  DIALOG_KEYS,
  type DialogKeyAction,
  OPEN_CARD_LINK_KEYS,
} from "../../lib/cardDialogKeys";
import { isTypingTarget, OPEN_OVERLAYS } from "../../lib/keyboardShortcuts";
import { isApplePlatform, isModKey } from "../../lib/platform";

export type CardModalKeyAction = DialogKeyAction | CardActionId;

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
    event.key === OPEN_CARD_LINK_KEYS[1] &&
    isModKey(event, apple) &&
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
  const action: CardModalKeyAction | undefined =
    cardActionsForKey(event.key, "dialog", apple).at(0) ??
    DIALOG_KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  if (!action) {
    return null;
  }
  if (event.repeat && action !== "previous" && action !== "next") {
    return null;
  }
  return action;
}

const OTHER_OVERLAYS = OPEN_OVERLAYS.join(", ");

/**
 * Whether Escape should close the card dialog although a tooltip is open. A
 * tooltip (one keyboard focus opened on an action button, say) sits above the
 * dialog and would take the first Escape for itself, so closing the card
 * took two presses. Only when nothing else (a menu, a dialog over the card)
 * is open: those keep their own Escape.
 */
export function escapeClosesOverTooltip(
  dialog: Element | null,
  root: ParentNode = document
): boolean {
  if (!(dialog && root.querySelector("[data-slot='tooltip-content']"))) {
    return false;
  }
  return Array.from(root.querySelectorAll(OTHER_OVERLAYS)).every(
    (overlay) => overlay === dialog
  );
}
