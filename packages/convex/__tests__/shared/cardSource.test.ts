import { describe, expect, test } from "bun:test";
import {
  MAX_SOURCE_TITLE_LENGTH,
  normalizeCardSource,
} from "../../shared/cardSource";

describe("normalizeCardSource", () => {
  test("keeps a trimmed http source with its title", () => {
    expect(
      normalizeCardSource({
        sourceTitle: "  Example  ",
        sourceUrl: " https://example.com/page ",
      })
    ).toEqual({
      sourceTitle: "Example",
      sourceUrl: "https://example.com/page",
    });
  });

  test.each(["javascript:alert(1)", "data:text/html,hi", "/relative/path"])(
    "drops an unsafe source URL: %s",
    (sourceUrl) => {
      expect(normalizeCardSource({ sourceTitle: "Page", sourceUrl })).toEqual(
        {}
      );
    }
  );

  test("cuts a long title by code point, never splitting an emoji", () => {
    const title = "🎨".repeat(MAX_SOURCE_TITLE_LENGTH + 5);
    const { sourceTitle } = normalizeCardSource({
      sourceTitle: title,
      sourceUrl: "https://example.com",
    });
    expect(sourceTitle).toBe("🎨".repeat(MAX_SOURCE_TITLE_LENGTH));
  });
});
