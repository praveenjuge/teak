import {
  type ActionCard,
  actsWhileSelecting,
  type CardActionId,
  type CardView,
  cardActionAvailable,
  cardActionsForKey,
  type SelectionAction,
  selectionKeyAction,
} from "./cardActions";
import type { GridDirection } from "./gridNavigation";
import { isApplePlatform, isModKey } from "./platform";

export interface GridKeyContext {
  addToFolder: boolean;
  allSelectedFavorited: boolean;
  hasSelection: boolean;
  isSelectionMode: boolean;
  view: CardView;
}

export type GridKeyAction =
  | { type: "move"; direction: GridDirection }
  | { type: "selection"; action: SelectionAction }
  | { type: "card"; action: CardActionId }
  | { type: "cancelSelection" }
  | { type: "blocked" };

const DIRECTIONS: Record<string, GridDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  j: "next",
  k: "previous",
};

/**
 * What a key pressed on a focused card in a grid does. A key that acts on a
 * selection is taken, and does nothing, while choosing cards for a folder.
 */
export function gridKeyAction(
  key: string,
  context: GridKeyContext,
  card: ActionCard,
  apple = isApplePlatform()
): GridKeyAction | null {
  const direction = DIRECTIONS[key];
  if (direction) {
    return { type: "move", direction };
  }
  if (key === "Escape") {
    return context.isSelectionMode ? { type: "cancelSelection" } : null;
  }
  const ids = cardActionsForKey(key, "grid", apple);
  if (ids.length === 0) {
    return null;
  }
  const selecting = context.addToFolder || context.hasSelection;
  for (const id of ids) {
    const onSelection = selectionKeyAction(id, context);
    if (onSelection !== null && context.addToFolder) {
      return { type: "blocked" };
    }
    if (onSelection !== null && context.hasSelection) {
      return onSelection === "blocked"
        ? { type: "blocked" }
        : { type: "selection", action: onSelection.action };
    }
  }
  const id = ids.find(
    (candidate) =>
      cardActionAvailable(candidate, card) &&
      (!selecting || actsWhileSelecting(candidate))
  );
  return id ? { type: "card", action: id } : null;
}

/** ⌘A on a Mac, Ctrl+A elsewhere: in selection mode it picks every card. */
export const isSelectAllKey = (
  event: GridModKeyEvent,
  apple = isApplePlatform()
): boolean => isModLetter(event, "a", apple);

/** ⌘C on a Mac, Ctrl+C elsewhere: a focused card's copy. */
export const isCopyCardKey = (
  event: GridModKeyEvent,
  apple = isApplePlatform()
): boolean => isModLetter(event, "c", apple);

type GridModKeyEvent = Pick<
  globalThis.KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "repeat" | "shiftKey"
>;

const isModLetter = (event: GridModKeyEvent, letter: string, apple: boolean) =>
  isModKey(event, apple) &&
  !(event.altKey || event.shiftKey || event.repeat) &&
  event.key.toLowerCase() === letter;
