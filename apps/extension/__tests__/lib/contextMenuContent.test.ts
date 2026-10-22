/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  assetSaveFor,
  isWebPageFile,
  pickSelectedText,
} from "../../lib/contextMenuContent";

describe("context menu content", () => {
  test("Save Asset keeps the clicked media and marks a plain link", () => {
    expect(
      assetSaveFor({
        linkUrl: "https://example.com/post",
        srcUrl: "https://cdn.example.com/a.png",
      })
    ).toEqual({ assetUrl: "https://cdn.example.com/a.png" });
    expect(assetSaveFor({ linkUrl: "https://example.com/post" })).toEqual({
      assetUrl: "https://example.com/post",
      link: true,
    });
    expect(assetSaveFor({})).toBeNull();
  });

  test("a downloaded web page is told apart from a file", () => {
    expect(isWebPageFile({ mimeType: "text/html; charset=utf-8" })).toBe(true);
    expect(isWebPageFile({ mimeType: "application/xhtml+xml" })).toBe(true);
    expect(isWebPageFile({ mimeType: "application/pdf" })).toBe(false);
    expect(isWebPageFile({ mimeType: "text/plain" })).toBe(false);
  });

  test("a selection keeps the page's line breaks over the menu's flattened copy", () => {
    expect(pickSelectedText("line one\nline two", "line one line two")).toBe(
      "line one\nline two"
    );
    expect(pickSelectedText("", "only the menu's")).toBe("only the menu's");
    expect(pickSelectedText(undefined, "  ")).toBeNull();
  });
});
