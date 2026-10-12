import { describe, expect, test } from "bun:test";
import { importedBookmarkTitle } from "../dataImport";

describe("importedBookmarkTitle", () => {
  const named: ["bookmarks" | "raindrop", string, string][] = [
    ["bookmarks", "Design reading list", "Design reading list"],
    ["raindrop", "  Trimmed name  ", "Trimmed name"],
  ];
  test.each(named)(
    "keeps the name a user gave a %s bookmark",
    (mode: "bookmarks" | "raindrop", content: string, expected: string) => {
      expect(
        importedBookmarkTitle(mode, {
          type: "link",
          content,
          url: "https://example.com/page",
        })
      ).toBe(expected);
    }
  );

  test("ignores the URL fallback the parsers use for unnamed bookmarks", () => {
    expect(
      importedBookmarkTitle("bookmarks", {
        type: "link",
        content: "https://example.com/page",
        url: "https://example.com/page",
      })
    ).toBeUndefined();
  });

  test("leaves archive imports alone, where link content is not a title", () => {
    expect(
      importedBookmarkTitle("archive", {
        type: "link",
        content: "My notes about this page",
        url: "https://example.com/page",
      })
    ).toBeUndefined();
  });
});
