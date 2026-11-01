import { describe, expect, test } from "bun:test";
import {
  focusedCardShortcuts,
  type GridKeyContext,
  gridKeyAction,
  isSelectAllKey,
  selectionShortcut,
} from "../gridKeys";

const browsing: GridKeyContext = {
  addToFolder: false,
  allSelectedFavorited: false,
  hasSelection: false,
  isSelectionMode: false,
  view: "library",
};
const selecting: GridKeyContext = {
  ...browsing,
  hasSelection: true,
  isSelectionMode: true,
};

describe("gridKeyAction", () => {
  test.each([
    ["ArrowUp", "up"],
    ["ArrowDown", "down"],
    ["ArrowLeft", "left"],
    ["ArrowRight", "right"],
    ["j", "next"],
    ["k", "previous"],
  ] as const)("%p moves %p, even with cards selected", (key, direction) => {
    expect(gridKeyAction(key, browsing)).toEqual({ type: "move", direction });
    expect(gridKeyAction(key, selecting)).toEqual({ type: "move", direction });
  });

  test.each([
    ["f", "favorite"],
    ["t", "addTags"],
    ["e", "archive"],
    ["Delete", "delete"],
    ["Backspace", "delete"],
    ["x", "select"],
  ] as const)("%p acts on the focused card: %p", (key, action) => {
    expect(gridKeyAction(key, browsing)).toEqual({ type: "card", action });
  });

  test.each([
    ["f", "favorite"],
    ["t", "addTags"],
    ["e", "archive"],
    ["Delete", "delete"],
  ] as const)(
    "with cards selected, %p acts on the selection: %p",
    (key, action) => {
      expect(gridKeyAction(key, selecting)).toEqual({
        type: "selection",
        action,
      });
    }
  );

  test("F removes a selection of favorites from favorites", () => {
    expect(
      gridKeyAction("f", { ...selecting, allSelectedFavorited: true })
    ).toEqual({ type: "selection", action: "unfavorite" });
  });

  test("E unarchives in the Archive", () => {
    expect(gridKeyAction("e", { ...selecting, view: "archive" })).toEqual({
      type: "selection",
      action: "unarchive",
    });
  });

  test("X still picks cards while some are selected", () => {
    expect(gridKeyAction("x", selecting)).toEqual({
      type: "card",
      action: "select",
    });
  });

  test("Escape leaves selection mode, and does nothing outside it", () => {
    expect(gridKeyAction("Escape", selecting)).toEqual({
      type: "cancelSelection",
    });
    expect(gridKeyAction("Escape", browsing)).toBeNull();
  });

  test.each(["f", "t", "e", "Delete"])(
    "%p is taken but does nothing while choosing cards for a folder",
    (key) => {
      expect(gridKeyAction(key, { ...browsing, addToFolder: true })).toEqual({
        type: "blocked",
      });
      expect(gridKeyAction(key, { ...selecting, addToFolder: true })).toEqual({
        type: "blocked",
      });
    }
  );

  test.each(["f", "t", "e"])(
    "%p does nothing to a selection in Trash",
    (key) => {
      expect(gridKeyAction(key, { ...selecting, view: "trash" })).toEqual({
        type: "blocked",
      });
    }
  );

  test.each(["Delete", "Backspace"])(
    "%p asks to delete a selection in Trash forever",
    (key) => {
      expect(gridKeyAction(key, { ...selecting, view: "trash" })).toEqual({
        type: "selection",
        action: "deleteForever",
      });
    }
  );

  test.each([
    [{ key: "a", metaKey: true }, true],
    [{ key: "A", ctrlKey: true }, true],
    [{ key: "a" }, false],
    [{ key: "a", metaKey: true, shiftKey: true }, false],
    [{ key: "a", ctrlKey: true, repeat: true }, false],
    [{ key: "c", metaKey: true }, false],
  ])("isSelectAllKey(%o) is %p", (event, expected) => {
    expect(
      isSelectAllKey({
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        repeat: false,
        shiftKey: false,
        ...event,
      })
    ).toBe(expected);
  });

  test("Delete asks to delete a card forever in Trash", () => {
    expect(gridKeyAction("Delete", { ...browsing, view: "trash" })).toEqual({
      type: "card",
      action: "deleteForever",
    });
  });

  test.each(["f", "t", "e"])("%p leaves a card in Trash alone", (key) => {
    expect(gridKeyAction(key, { ...browsing, view: "trash" })).toBeNull();
  });

  test("leaves other keys to the card and the page", () => {
    expect(gridKeyAction("Enter", browsing)).toBeNull();
    expect(gridKeyAction("a", selecting)).toBeNull();
  });
});

describe("focusedCardShortcuts", () => {
  test("shows every card key outside selection mode", () => {
    expect(Object.keys(focusedCardShortcuts(false, true)).sort()).toEqual([
      "addTags",
      "archive",
      "copy",
      "delete",
      "favorite",
      "select",
    ]);
  });

  test("shows only the keys that still act on the card in selection mode", () => {
    expect(Object.keys(focusedCardShortcuts(true, true)).sort()).toEqual([
      "copy",
      "select",
    ]);
  });
});

describe("selectionShortcut", () => {
  const library = {
    addToFolder: false,
    allSelectedFavorited: false,
    view: "library" as const,
  };

  test.each([
    ["favorite", "F"],
    ["addTags", "T"],
    ["archive", "E"],
    ["delete", "⌫"],
  ] as const)("names the key for %p", (action, label) => {
    expect(selectionShortcut(action, library, true)?.label).toBe(label);
  });

  test("puts F on the action it does now", () => {
    expect(selectionShortcut("unfavorite", library, true)).toBeUndefined();
    const favorites = { ...library, allSelectedFavorited: true };
    expect(selectionShortcut("unfavorite", favorites, true)?.label).toBe("F");
    expect(selectionShortcut("favorite", favorites, true)).toBeUndefined();
  });

  test("gives E to Unarchive in the Archive", () => {
    const archive = { ...library, view: "archive" as const };
    expect(selectionShortcut("unarchive", archive, true)?.label).toBe("E");
  });

  test("gives Delete to Delete forever in Trash", () => {
    const trash = { ...library, view: "trash" as const };
    expect(selectionShortcut("deleteForever", trash, true)?.label).toBe("⌫");
  });

  test.each([
    ["restore", { ...library, view: "trash" as const }],
    ["addToFolder", { ...library, addToFolder: true }],
    ["removeTags", library],
  ] as const)("gives %p no key", (action, context) => {
    expect(selectionShortcut(action, context, true)).toBeUndefined();
  });
});
