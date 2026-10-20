import { describe, expect, test } from "bun:test";
import { getPrimaryModifierLabel } from "../platform";

describe("getPrimaryModifierLabel", () => {
  test.each([
    [{ platform: "MacIntel" }, "Cmd"],
    [{ userAgentData: { platform: "macOS" } }, "Cmd"],
    [{ platform: "iPhone" }, "Cmd"],
    [{ platform: "Linux x86_64" }, "Ctrl"],
    [{ platform: "Win32" }, "Ctrl"],
    [{ userAgentData: { platform: "Windows" }, platform: "" }, "Ctrl"],
    [{ userAgent: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)" }, "Ctrl"],
  ])("labels the save shortcut key for %p as %p", (nav, expected) => {
    expect(getPrimaryModifierLabel(nav)).toBe(expected);
  });
});
