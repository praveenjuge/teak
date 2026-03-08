// @ts-nocheck
import { describe, expect, test } from "bun:test";

import { getInlineSaveButtonPosition } from "../../entrypoints/content/platformButtonLayout";

describe("platformButtonLayout", () => {
  test("keeps x in the lowered top-right position", () => {
    expect(getInlineSaveButtonPosition("x")).toEqual({
      top: "24px",
      right: "8px",
      bottom: "auto",
      left: "auto",
    });
  });

  test("keeps instagram in the lowered top-right position", () => {
    expect(getInlineSaveButtonPosition("instagram")).toEqual({
      top: "24px",
      right: "8px",
      bottom: "auto",
      left: "auto",
    });
  });

  test("moves pinterest to the bottom-left position", () => {
    expect(getInlineSaveButtonPosition("pinterest")).toEqual({
      top: "auto",
      right: "auto",
      bottom: "16px",
      left: "16px",
    });
  });
});
