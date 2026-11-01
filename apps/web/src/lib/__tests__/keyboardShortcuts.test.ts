import { describe, expect, mock, test } from "bun:test";
import {
  ariaKeyShortcut,
  cardAriaKeyShortcuts,
  keyboardShortcutGroups,
  openKeyboardShortcuts,
  platformKey,
  pressRecordAudio,
  pressUploadFiles,
  registerRecordAudio,
  registerShortcutsOpener,
  registerUploadFiles,
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

describe("cardAriaKeyShortcuts", () => {
  test("names every key a focused card answers, with the Mac's ⌫ as Backspace", () => {
    expect(cardAriaKeyShortcuts(false, false)).toBe("Enter F T E X Delete");
    expect(cardAriaKeyShortcuts(false, true)).toBe("Enter F T E X Backspace");
  });

  test("a card that copies adds its copy key, per platform", () => {
    expect(cardAriaKeyShortcuts(false, false, true)).toBe(
      "Enter F T E X Delete Control+C"
    );
    expect(cardAriaKeyShortcuts(false, true, true)).toBe(
      "Enter F T E X Backspace Meta+C"
    );
  });

  test("a card in Trash only selects and deletes forever", () => {
    expect(cardAriaKeyShortcuts(true, false)).toBe("Enter X Delete");
    expect(cardAriaKeyShortcuts(true, false, true)).toBe("Enter X Delete");
  });
});

describe("pressUploadFiles", () => {
  test("runs the latest registered upload, then the one before once it leaves", () => {
    const toolbar = mock(() => true);
    const header = mock(() => true);
    const leaveToolbar = registerUploadFiles(toolbar);
    const leaveHeader = registerUploadFiles(header);

    expect(pressUploadFiles()).toBe(true);
    expect(header).toHaveBeenCalledTimes(1);
    expect(toolbar).not.toHaveBeenCalled();

    leaveHeader();
    expect(pressUploadFiles()).toBe(true);
    expect(toolbar).toHaveBeenCalledTimes(1);

    leaveToolbar();
    expect(pressUploadFiles()).toBe(false);
  });

  test("reports an upload that can't start now", () => {
    const leave = registerUploadFiles(() => false);
    expect(pressUploadFiles()).toBe(false);
    leave();
  });
});

describe("pressRecordAudio", () => {
  test("runs the latest registered recorder, and reports none", () => {
    expect(pressRecordAudio()).toBe(false);
    const record = mock(() => true);
    const leave = registerRecordAudio(record);
    expect(pressRecordAudio()).toBe(true);
    expect(record).toHaveBeenCalledTimes(1);
    leave();
    expect(pressRecordAudio()).toBe(false);
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

describe("openKeyboardShortcuts", () => {
  test("opens the sheet the shell registered, and nothing once it leaves", () => {
    const open = mock(() => undefined);
    expect(openKeyboardShortcuts()).toBe(false);
    const unregister = registerShortcutsOpener(open);
    expect(openKeyboardShortcuts()).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    unregister();
    expect(openKeyboardShortcuts()).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
