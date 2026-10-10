import { describe, expect, test } from "bun:test";

import {
  applyHueFilter,
  applyTagFilter,
  applyTrashedFilter,
  applyTypeFilter,
  buildSearchText,
  clearSearchFilters,
  parseSearchFilters,
} from "../lib/searchFilters";

describe("parseSearchFilters", () => {
  test("parses a simple single-word tag", () => {
    const parsed = parseSearchFilters("tag:design");
    expect(parsed.tag).toBe("design");
    expect(parsed.query).toBe("");
  });

  test("keeps a quoted tag with spaces intact", () => {
    const parsed = parseSearchFilters('tag:"design systems"');
    expect(parsed.tag).toBe("design systems");
    expect(parsed.query).toBe("");
  });

  test("separates a quoted tag from free-text query terms", () => {
    const parsed = parseSearchFilters('hello tag:"design systems" world');
    expect(parsed.tag).toBe("design systems");
    expect(parsed.query).toBe("hello world");
  });

  test("handles escaped quotes inside a quoted value", () => {
    const parsed = parseSearchFilters('tag:"a \\"quoted\\" tag"');
    expect(parsed.tag).toBe('a "quoted" tag');
  });

  test("treats a bare colon value as the tag (legacy unquoted)", () => {
    const parsed = parseSearchFilters("tag:design");
    expect(parsed.tag).toBe("design");
  });
});

describe("buildSearchText", () => {
  test("quotes a tag containing spaces", () => {
    expect(buildSearchText({ tag: "design systems" })).toBe(
      'tag:"design systems"',
    );
  });

  test("leaves a simple tag unquoted", () => {
    expect(buildSearchText({ tag: "design" })).toBe("tag:design");
  });

  test("escapes quotes and backslashes in a tag", () => {
    expect(buildSearchText({ tag: 'a "b" \\c' })).toBe('tag:"a \\"b\\" \\\\c"');
  });
});

describe("filter round-trips", () => {
  test("applyTagFilter round-trips a multi-word tag", () => {
    const next = applyTagFilter("", "design systems");
    expect(next).toBe('tag:"design systems"');
    expect(parseSearchFilters(next).tag).toBe("design systems");
  });

  test("applyTagFilter preserves existing free text and type", () => {
    const next = applyTagFilter("type:link inspiration", "design systems");
    const parsed = parseSearchFilters(next);
    expect(parsed.tag).toBe("design systems");
    expect(parsed.type).toBe("link");
    expect(parsed.query).toBe("inspiration");
  });

  test("applyTypeFilter does not corrupt an existing multi-word tag", () => {
    const withTag = applyTagFilter("", "design systems");
    const next = applyTypeFilter(withTag, "image");
    const parsed = parseSearchFilters(next);
    expect(parsed.tag).toBe("design systems");
    expect(parsed.type).toBe("image");
  });

  test("clearSearchFilters keeps free text and drops the tag", () => {
    const next = clearSearchFilters('hello tag:"design systems"');
    expect(next).toBe("hello");
  });
});

describe("color, Trash, and date filters", () => {
  test("parses trash, hue, style, hex, and dates out of the query", () => {
    const parsed = parseSearchFilters(
      "poster trash hue:Blue style:minimal #112233 after:2026-09 before:2026-10-15",
    );
    expect(parsed).toMatchObject({
      query: "poster",
      trashed: true,
      hue: ["blue"],
      style: ["minimal"],
      hex: ["#112233"],
      createdAfter: new Date(2026, 8, 1).getTime(),
      createdBefore: new Date(2026, 9, 15).getTime(),
      hasExplicitFilters: true,
    });
  });

  test("leaves unknown hues and malformed dates as search words", () => {
    const parsed = parseSearchFilters("hue:plaid after:soon #12");
    expect(parsed.hue).toEqual([]);
    expect(parsed.createdAfter).toBeUndefined();
    expect(parsed.query).toBe("hue:plaid after:soon #12");
  });

  test("round-trips filters through the search text", () => {
    const text = buildSearchText(
      parseSearchFilters("trash hue:teal #abcdef after:2026-01-02"),
    );
    expect(parseSearchFilters(text)).toMatchObject({
      trashed: true,
      hue: ["teal"],
      hex: ["#abcdef"],
      createdAfter: new Date(2026, 0, 2).getTime(),
    });
  });

  test("Show Trash and color filters toggle without losing the query", () => {
    const inTrash = applyTrashedFilter("poster type:image", true);
    expect(parseSearchFilters(inTrash)).toMatchObject({
      query: "poster",
      trashed: true,
      type: "image",
    });
    expect(
      parseSearchFilters(applyTrashedFilter(inTrash)).trashed,
    ).toBeUndefined();
    expect(parseSearchFilters(applyHueFilter("poster", "red")).hue).toEqual([
      "red",
    ]);
  });
});
