import { describe, expect, test } from "bun:test";
import {
  type ActionCard,
  type CardActionId,
  cardActionForKey,
  cardAriaKeyShortcuts,
  GRID_CARD_ACTIONS,
  STRIP_CARD_ACTIONS,
  selectionShortcut,
} from "../cardActions";
import { englishTranslator } from "../englishTranslators";
import { keyboardShortcutGroups } from "../keyboardShortcuts";

const GRID_WITH_COPY: ReadonlySet<CardActionId> = new Set([
  "copy",
  "favorite",
  "pin",
  "addTags",
  "archive",
  "moveToTrash",
  "restore",
  "deleteForever",
  "select",
]);

const GRID: ReadonlySet<CardActionId> = new Set([
  "favorite",
  "pin",
  "addTags",
  "archive",
  "moveToTrash",
  "restore",
  "deleteForever",
  "select",
]);

describe("card menus", () => {
  test("a grid card offers everything but marking done, which the open card does", () => {
    expect(GRID_CARD_ACTIONS.has("done")).toBe(false);
    expect(GRID_CARD_ACTIONS.has("select")).toBe(true);
  });

  test("a pinned card offers nothing that needs a selection or Trash", () => {
    for (const action of ["select", "restore", "deleteForever"] as const) {
      expect(STRIP_CARD_ACTIONS.has(action)).toBe(false);
    }
    expect(STRIP_CARD_ACTIONS.has("pin")).toBe(true);
  });
});

describe("cardActionForKey", () => {
  test.each([
    ["f", "favorite"],
    ["p", "pin"],
    ["t", "addTags"],
    ["e", "archive"],
    ["Delete", "moveToTrash"],
    ["d", "done"],
    ["c", "copy"],
  ] as const)("in the open card, %p runs %p", (key, action) => {
    expect(
      cardActionForKey(
        key,
        "dialog",
        { type: "link", url: "https://example.com" },
        false
      )
    ).toBe(action);
  });

  test("Delete deletes a card in Trash forever, from the grid only", () => {
    const inTrash: ActionCard = { isDeleted: true };
    expect(cardActionForKey("Delete", "grid", inTrash, false)).toBe(
      "deleteForever"
    );
    expect(cardActionForKey("Delete", "dialog", inTrash, false)).toBeNull();
  });

  test("nothing in Archive or Trash can be pinned", () => {
    expect(cardActionForKey("p", "grid", { isArchived: true }, false)).toBe(
      null
    );
    expect(cardActionForKey("p", "dialog", { isDeleted: true }, false)).toBe(
      null
    );
  });

  test("only a link can be marked done", () => {
    expect(cardActionForKey("d", "dialog", { type: "text" }, false)).toBe(null);
  });
});

describe("keyboard shortcuts list", () => {
  // The rows the list shows for card actions, and the action each names.
  const ROW_ACTIONS: Record<string, CardActionId> = {
    addTag: "addTags",
    addTags: "addTags",
    archive: "archive",
    copy: "copy",
    favorite: "favorite",
    markLinkDone: "done",
    moveToTrash: "moveToTrash",
    pin: "pin",
    select: "select",
  };

  test("lists the key that runs each card action, in the grid and the open card", () => {
    const link: ActionCard = { type: "link", url: "https://example.com" };
    for (const group of keyboardShortcutGroups(
      englishTranslator("shortcuts")
    )) {
      if (group.id !== "cards" && group.id !== "openCard") {
        continue;
      }
      const surface = group.id === "cards" ? "grid" : "dialog";
      for (const row of group.rows) {
        const action = row.id ? ROW_ACTIONS[row.id] : undefined;
        // A grid's copy is ⌘C or Ctrl+C, a combo, not one key.
        if (!action || row.combo) {
          continue;
        }
        const [key] = row.keys;
        expect(
          cardActionForKey(
            key === "Delete" ? key : (key ?? "").toLowerCase(),
            surface,
            link,
            false
          )
        ).toBe(action);
      }
    }
  });
});

describe("cardAriaKeyShortcuts", () => {
  test("names every key a focused card answers, with the Mac's ⌫ as Backspace", () => {
    expect(cardAriaKeyShortcuts({}, GRID, { apple: false })).toBe(
      "Enter F P T E Delete X"
    );
    expect(cardAriaKeyShortcuts({}, GRID, { apple: true })).toBe(
      "Enter F P T E Backspace X"
    );
  });

  test("a card that copies adds its copy key, per platform", () => {
    const note: ActionCard = { type: "text" };
    expect(cardAriaKeyShortcuts(note, GRID_WITH_COPY, { apple: false })).toBe(
      "Enter F P T E Delete X Control+C"
    );
    expect(cardAriaKeyShortcuts(note, GRID_WITH_COPY, { apple: true })).toBe(
      "Enter F P T E Backspace X Meta+C"
    );
    expect(cardAriaKeyShortcuts(note, GRID, { apple: false })).toBe(
      "Enter F P T E Delete X"
    );
  });

  test("while cards are selected, a card only toggles itself", () => {
    expect(
      cardAriaKeyShortcuts({ type: "text" }, GRID_WITH_COPY, {
        apple: false,
        selecting: true,
      })
    ).toBe("Enter X");
  });

  test("a card in Trash only deletes forever and selects", () => {
    expect(
      cardAriaKeyShortcuts({ isDeleted: true }, GRID, { apple: false })
    ).toBe("Enter Delete X");
  });

  test("a surface without selection doesn't offer X", () => {
    const strip = new Set<CardActionId>(["favorite", "pin"]);
    expect(cardAriaKeyShortcuts({}, strip, { apple: false })).toBe("Enter F P");
  });
});

describe("selectionShortcut", () => {
  const library = {
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
    ["removeTags", library],
  ] as const)("gives %p no key", (action, context) => {
    expect(selectionShortcut(action, context, true)).toBeUndefined();
  });
});
