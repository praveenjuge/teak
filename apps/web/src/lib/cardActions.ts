import type { BulkCardAction } from "@teak/convex/card/bulkActions";
import type { Messages } from "@teak/i18n";
import { isApplePlatform } from "./platform";

/**
 * The actions a person takes on a card, in one list: the key that runs each,
 * where it can run, its menu label and what it does to a selection. The card
 * menu, the card dialog, the grid's keys, the selection bar and the shortcuts
 * dialog all read from here; `useCardActions` runs them.
 */
export type CardActionId =
  | "favorite"
  | "pin"
  | "addTags"
  | "archive"
  | "moveToTrash"
  | "restore"
  | "deleteForever"
  | "select"
  | "done";

/** Where a key runs: on the focused card in a grid, or in the card dialog. */
export type CardKeySurface = "grid" | "dialog";

/** Which cards a grid lists, for what a key does to a selection. */
export type CardView = "library" | "archive" | "trash";

export type SelectionAction = BulkCardAction | "copyLinks" | "deleteForever";

export interface ActionCard {
  isArchived?: boolean;
  isDeleted?: boolean;
  isFavorited?: boolean;
  pinPosition?: number;
  type?: string;
}

export interface SelectionContext {
  allSelectedFavorited: boolean;
  view: CardView;
}

type CardMenuLabel = keyof Messages["cards"]["menu"];

interface CardActionDefinition {
  actsWhileSelecting?: true;
  available: (card: ActionCard) => boolean;
  /** As `KeyboardEvent.key`, letters lowercase. */
  key?: string;
  keySurfaces: readonly CardKeySurface[];
  label?: (card: ActionCard) => CardMenuLabel;
  /**
   * What the key does while cards are selected. Without it the key leaves a
   * selection alone, unless `actsWhileSelecting` keeps it on the card.
   */
  onSelection?: (context: SelectionContext) => SelectionAction | null;
}

const DELETE_KEY = "Delete";
const BOTH: readonly CardKeySurface[] = ["grid", "dialog"];

const inLibrary = (card: ActionCard) => !card.isDeleted;
const inTrash = (card: ActionCard) => Boolean(card.isDeleted);

export const CARD_ACTIONS: Record<CardActionId, CardActionDefinition> = {
  favorite: {
    available: inLibrary,
    key: "f",
    keySurfaces: BOTH,
    label: (card) => (card.isFavorited ? "unfavorite" : "favorite"),
    onSelection: ({ allSelectedFavorited, view }) => {
      if (view === "trash") {
        return null;
      }
      return allSelectedFavorited ? "unfavorite" : "favorite";
    },
  },
  // Pins are one card at a time, and nothing in Trash or Archive is pinned.
  pin: {
    available: (card) => !(card.isDeleted || card.isArchived),
    key: "p",
    keySurfaces: BOTH,
    label: (card) => (card.pinPosition === undefined ? "pin" : "unpin"),
  },
  addTags: {
    available: inLibrary,
    key: "t",
    keySurfaces: BOTH,
    label: () => "addTags",
    onSelection: ({ view }) => (view === "trash" ? null : "addTags"),
  },
  archive: {
    available: inLibrary,
    key: "e",
    keySurfaces: BOTH,
    label: (card) => (card.isArchived ? "unarchive" : "archive"),
    onSelection: ({ view }) => {
      if (view === "trash") {
        return null;
      }
      return view === "archive" ? "unarchive" : "archive";
    },
  },
  moveToTrash: {
    available: inLibrary,
    key: DELETE_KEY,
    keySurfaces: BOTH,
    label: () => "moveToTrash",
    onSelection: ({ view }) => (view === "trash" ? "deleteForever" : "delete"),
  },
  restore: {
    available: inTrash,
    keySurfaces: [],
    label: () => "restore",
  },
  deleteForever: {
    available: inTrash,
    key: DELETE_KEY,
    keySurfaces: ["grid"],
    label: () => "deleteForever",
    onSelection: ({ view }) => (view === "trash" ? "deleteForever" : "delete"),
  },
  select: {
    actsWhileSelecting: true,
    available: () => true,
    key: "x",
    keySurfaces: ["grid"],
    label: () => "select",
  },
  done: {
    available: (card) => card.type === "link" && !card.isDeleted,
    key: "d",
    keySurfaces: ["dialog"],
  },
};

const CARD_ACTION_IDS = Object.keys(CARD_ACTIONS) as CardActionId[];

/** What a card in a grid offers; marking done belongs to the open card. */
export const GRID_CARD_ACTIONS: ReadonlySet<CardActionId> = new Set(
  CARD_ACTION_IDS.filter((id) => id !== "done")
);

export const cardActionAvailable = (
  id: CardActionId,
  card: ActionCard
): boolean => CARD_ACTIONS[id].available(card);

export const cardActionLabel = (
  id: CardActionId,
  card: ActionCard
): CardMenuLabel | undefined => CARD_ACTIONS[id].label?.(card);

/**
 * Whether a pressed key is an action's key. The grid takes Backspace for
 * Delete everywhere; the dialog only on Apple platforms, where it is the
 * Delete key (⌫).
 */
const pressesKey = (
  key: string,
  pressed: string,
  surface: CardKeySurface,
  apple: boolean
) => {
  if (key === DELETE_KEY) {
    return (
      pressed === DELETE_KEY ||
      (pressed === "Backspace" && (surface === "grid" || apple))
    );
  }
  return pressed.toLowerCase() === key;
};

/** The actions bound to a pressed key on a surface, first match first. */
export const cardActionsForKey = (
  pressed: string,
  surface: CardKeySurface,
  apple = isApplePlatform()
): CardActionId[] =>
  CARD_ACTION_IDS.filter((id) => {
    const { key, keySurfaces } = CARD_ACTIONS[id];
    return (
      key !== undefined &&
      keySurfaces.includes(surface) &&
      pressesKey(key, pressed, surface, apple)
    );
  });

/** The action a key runs on this card, if the card can take it. */
export const cardActionForKey = (
  pressed: string,
  surface: CardKeySurface,
  card: ActionCard,
  apple = isApplePlatform()
): CardActionId | null =>
  cardActionsForKey(pressed, surface, apple).find((id) =>
    cardActionAvailable(id, card)
  ) ?? null;

export interface MenuShortcut {
  /** For `aria-keyshortcuts`. */
  keys: string;
  /** What a menu shows. */
  label: string;
}

/** The key a shortcut list shows, before `platformKey`: `F`, `Delete`. */
export const cardActionKeyName = (id: CardActionId): string | undefined => {
  const key = CARD_ACTIONS[id].key;
  return key && key.length === 1 ? key.toUpperCase() : key;
};

/** The browser calls the Mac's Delete key (⌫) Backspace. */
export function cardActionShortcut(
  id: CardActionId,
  apple = isApplePlatform()
): MenuShortcut | undefined {
  const key = CARD_ACTIONS[id].key;
  if (!key) {
    return;
  }
  if (key === DELETE_KEY) {
    return apple
      ? { keys: "Backspace", label: "⌫" }
      : { keys: "Delete", label: "Del" };
  }
  const name = key.toUpperCase();
  return { keys: name, label: name };
}

/** ⌘C on a Mac, Ctrl+C elsewhere: a focused card's copy. */
export const copyCardShortcut = (apple = isApplePlatform()): MenuShortcut =>
  apple
    ? { keys: "Meta+C", label: "⌘C" }
    : { keys: "Control+C", label: "Ctrl+C" };

/**
 * What a key does to the cards selected in a grid: an action on them, nothing
 * (`blocked`, the key is still taken), or `null` when the key isn't about the
 * selection.
 */
export function selectionKeyAction(
  id: CardActionId,
  context: SelectionContext
): { action: SelectionAction } | "blocked" | null {
  const { onSelection } = CARD_ACTIONS[id];
  if (!onSelection) {
    return null;
  }
  const action = onSelection(context);
  return action ? { action } : "blocked";
}

/** The shortcut the selection bar shows for one of its actions. */
export function selectionShortcut(
  action: SelectionAction,
  context: SelectionContext,
  apple = isApplePlatform()
): MenuShortcut | undefined {
  const id = CARD_ACTION_IDS.find(
    (candidate) =>
      CARD_ACTIONS[candidate].keySurfaces.includes("grid") &&
      CARD_ACTIONS[candidate].onSelection?.(context) === action
  );
  return id ? cardActionShortcut(id, apple) : undefined;
}

/** Whether an action's key still acts on the focused card while selecting. */
export const actsWhileSelecting = (id: CardActionId): boolean =>
  CARD_ACTIONS[id].actsWhileSelecting === true;

/**
 * What a focused card in a grid answers, for its `aria-keyshortcuts`: the
 * card's menu items are hidden until hover, so this is how a screen reader
 * learns them. While cards are selected F, T, E and Delete act on the
 * selection, so the card only answers Enter and X.
 */
export function cardAriaKeyShortcuts(
  card: ActionCard,
  offered: ReadonlySet<CardActionId>,
  {
    apple = isApplePlatform(),
    canCopy = false,
    selecting = false,
  }: { apple?: boolean; canCopy?: boolean; selecting?: boolean } = {}
): string {
  const keys = ["Enter"];
  for (const id of CARD_ACTION_IDS) {
    if (
      offered.has(id) &&
      CARD_ACTIONS[id].keySurfaces.includes("grid") &&
      cardActionAvailable(id, card) &&
      (!selecting || actsWhileSelecting(id))
    ) {
      const shortcut = cardActionShortcut(id, apple);
      if (shortcut) {
        keys.push(shortcut.keys);
      }
    }
  }
  if (canCopy && !selecting) {
    keys.push(copyCardShortcut(apple).keys);
  }
  return keys.join(" ");
}
