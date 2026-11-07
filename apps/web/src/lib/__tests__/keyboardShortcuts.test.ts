import { describe, expect, test } from "bun:test";
import {
  ariaKeyShortcut,
  keyboardShortcutGroups,
  platformKey,
} from "../keyboardShortcuts";

describe("platformKey", () => {
  test.each([
    ["Mod", "⌘", "Ctrl"],
    ["Shift", "⇧", "Shift"],
    ["Enter", "↩", "Enter"],
    ["Alt", "⌥", "Alt"],
    ["Delete", "⌫", "Delete"],
    ["B", "B", "B"],
  ])("labels %p as %p on a Mac and %p elsewhere", (key, mac, other) => {
    expect(platformKey(key, true)).toBe(mac);
    expect(platformKey(key, false)).toBe(other);
  });
});

describe("ariaKeyShortcut", () => {
  test("names Mod as Meta on a Mac and Control elsewhere", () => {
    expect(ariaKeyShortcut(["Mod", "Shift", "S"], true)).toBe("Meta+Shift+S");
    expect(ariaKeyShortcut(["Mod", "Enter"], false)).toBe("Control+Enter");
  });

  test("uses the key names aria-keyshortcuts expects", () => {
    expect(ariaKeyShortcut(["Esc"])).toBe("Escape");
    expect(ariaKeyShortcut(["←"])).toBe("ArrowLeft");
    expect(ariaKeyShortcut(["F"])).toBe("F");
  });

  test("names Delete as Backspace on a Mac, the key the card menu answers", () => {
    expect(ariaKeyShortcut(["Delete"], true)).toBe("Backspace");
    expect(ariaKeyShortcut(["Delete"], false)).toBe("Delete");
  });
});

describe("the Anywhere group", () => {
  test("lists every New menu item with its own key, and no key twice", () => {
    const anywhere = keyboardShortcutGroups().find(
      (group) => group.id === "anywhere"
    );
    const rows = anywhere?.rows.map((row) => [row.keys.join(" "), row.label]);
    expect(rows).toContainEqual(["N", "New note"]);
    expect(rows).toContainEqual(["U", "Upload files"]);
    expect(rows).toContainEqual(["R", "Record audio"]);
    const keys = rows?.map(([keys]) => keys) ?? [];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("the Search group", () => {
  test("teaches the search operators", () => {
    const search = keyboardShortcutGroups().find(
      (group) => group.title === "Search"
    );
    expect(search?.rows.map((row) => [row.keys.join(" "), row.label])).toEqual([
      ["tag:design", "Cards with a tag"],
      ["type:note", "Cards of a type"],
      ["site:github.com", "Cards from a site"],
      ["folder:reading", "Cards in a folder"],
      ["is:fav", "Favorites, archived, done or to-do"],
      ["-word", "Exclude a word"],
      ["-tag:x", "Exclude a tag, type, site or folder"],
      ["a OR b", "Either one"],
      ["( … )", "Group"],
      ['"phrase"', "Exact words"],
    ]);
    expect(search?.rows.every((row) => row.syntax)).toBe(true);
  });
});

describe("the Go to group", () => {
  test("names each place alike, Tags included, with no repeated keys", () => {
    const goTo = keyboardShortcutGroups().find((group) => group.id === "goTo");
    expect(goTo?.rows.map((row) => [row.keys.join(" "), row.label])).toEqual([
      ["G E", "Everything"],
      ["G F", "Favorites"],
      ["G A", "Archive"],
      ["G T", "Trash"],
      ["G L", "Tags"],
      ["G S", "Settings"],
    ]);
    const keys = goTo?.rows.map((row) => row.keys.join(" ")) ?? [];
    expect(new Set(keys).size).toBe(keys.length);
  });
});
