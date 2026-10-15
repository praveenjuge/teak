import { describe, expect, test } from "bun:test";
import { ariaKeyShortcut, platformKey } from "../keyboardShortcuts";

describe("platformKey", () => {
  test.each([
    ["Mod", "⌘", "Ctrl"],
    ["Shift", "⇧", "Shift"],
    ["Enter", "↩", "Enter"],
    ["Alt", "⌥", "Alt"],
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
});
