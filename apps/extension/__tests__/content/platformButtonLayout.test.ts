// @ts-nocheck
import { describe, expect, test } from "bun:test";

import { getInlineSaveButtonPosition } from "../../entrypoints/content/platformButtonLayout";

describe("platformButtonLayout", () => {
  test("keeps x in the lower-left position", () => {
    expect(getInlineSaveButtonPosition("x")).toEqual({
      top: "auto",
      right: "auto",
      bottom: "8px",
      left: "8px",
    });
  });

  test("keeps instagram in the raised top-right position", () => {
    expect(getInlineSaveButtonPosition("instagram")).toEqual({
      top: "54px",
      right: "8px",
      bottom: "auto",
      left: "auto",
    });
  });

  test("keeps pinterest in the high top-right position", () => {
    expect(getInlineSaveButtonPosition("pinterest")).toEqual({
      top: "64px",
      right: "12px",
      bottom: "auto",
      left: "auto",
    });
  });

  test("positions Hacker News in the top-right corner", () => {
    expect(getInlineSaveButtonPosition("hackernews")).toEqual({
      top: "8px",
      right: "8px",
      bottom: "auto",
      left: "auto",
    });
  });

  test("keeps compact aggregator platforms aligned with Hacker News", () => {
    expect(getInlineSaveButtonPosition("sidebar")).toEqual({
      top: "8px",
      right: "8px",
      bottom: "auto",
      left: "auto",
    });
    expect(getInlineSaveButtonPosition("webdesignernews")).toEqual({
      top: "8px",
      right: "8px",
      bottom: "auto",
      left: "auto",
    });
    expect(getInlineSaveButtonPosition("heydesigner")).toEqual({
      top: "8px",
      right: "8px",
      bottom: "auto",
      left: "auto",
    });
  });
});
