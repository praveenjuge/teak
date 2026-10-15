import { describe, expect, mock, test } from "bun:test";
import {
  ariaKeyShortcut,
  platformKey,
  pressUploadFiles,
  registerUploadFiles,
} from "../keyboardShortcuts";

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
