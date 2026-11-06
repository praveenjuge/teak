/**
 * The keys only the open card has; its card actions (F, P, C…) take theirs
 * from `cardActions.ts`. The dialog's key handler and the shortcuts list
 * both read this table.
 */
export type DialogKeyAction =
  | "previous"
  | "next"
  | "focusNotes"
  | "open"
  | "toggleReader"
  | "highlight";

/** As `KeyboardEvent.key`, letters lowercase. */
export const DIALOG_KEYS: Readonly<Record<string, DialogKeyAction>> = {
  ArrowLeft: "previous",
  ArrowRight: "next",
  k: "previous",
  j: "next",
  n: "focusNotes",
  o: "open",
  r: "toggleReader",
  h: "highlight",
};

/** ⌘↵ (Ctrl+Enter elsewhere) also opens the card, except in a field. */
export const OPEN_CARD_LINK_KEYS = ["Mod", "Enter"] as const;

/** The letter a list shows for a dialog key: `N`. */
export const dialogKeyName = (action: DialogKeyAction): string => {
  const key = Object.keys(DIALOG_KEYS).find(
    (candidate) => candidate.length === 1 && DIALOG_KEYS[candidate] === action
  );
  return key ? key.toUpperCase() : "";
};
