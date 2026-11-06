import { describe, expect, test } from "bun:test";
import { isApplePlatform, isModKey } from "../platform";

describe("isApplePlatform", () => {
  test.each([
    [{ platform: "MacIntel" }, true],
    [{ userAgentData: { platform: "macOS" } }, true],
    [{ platform: "iPhone" }, true],
    [{ platform: "Linux x86_64" }, false],
    [{ platform: "Win32" }, false],
    [{ userAgentData: { platform: "Windows" }, platform: "" }, false],
    [{ userAgent: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)" }, false],
  ])("reads %p as Apple: %p", (nav, expected) => {
    expect(isApplePlatform(nav)).toBe(expected);
  });
});

describe("isModKey", () => {
  test.each([
    [true, { metaKey: true, ctrlKey: false }, true],
    [true, { metaKey: false, ctrlKey: true }, false],
    [true, { metaKey: true, ctrlKey: true }, false],
    [false, { metaKey: false, ctrlKey: true }, true],
    [false, { metaKey: true, ctrlKey: false }, false],
    [false, { metaKey: true, ctrlKey: true }, false],
  ])("on Apple %p, %o is the shortcut key: %p", (apple, event, expected) => {
    expect(isModKey(event, apple)).toBe(expected);
  });
});
