import { describe, expect, test } from "bun:test";
import {
  explainInvalidCardTags,
  explainInvalidTagName,
  isCardHidden,
  isHiddenTagList,
  MAX_CARD_TAGS,
  normalizeTagList,
  rewriteTagList,
  tagExistsMessage,
  tagKey,
} from "../../shared/tags";

describe("rewriteTagList", () => {
  test("leaves lists without the tag alone", () => {
    expect(rewriteTagList(undefined, { kind: "delete", from: "a" })).toBeNull();
    expect(rewriteTagList([], { kind: "delete", from: "a" })).toBeNull();
    expect(
      rewriteTagList(["ab", "b"], { kind: "rename", from: "a", to: "c" })
    ).toBeNull();
  });

  test("rename writes the new name as given and collapses case variants", () => {
    expect(
      rewriteTagList(["Design", "web", "DESIGN"], {
        kind: "rename",
        from: "design",
        to: " Design Systems ",
      })
    ).toEqual(["Design Systems", "web"]);
  });

  test("rename onto a tag already on the card keeps one, in the new casing", () => {
    expect(
      rewriteTagList(["design", "ui", "UI"], {
        kind: "rename",
        from: "design",
        to: "Ui",
      })
    ).toEqual(["Ui"]);
  });

  test("a case-only rename recases every variant", () => {
    expect(
      rewriteTagList(["design", "x"], {
        kind: "rename",
        from: "DESIGN",
        to: "Design",
      })
    ).toEqual(["Design", "x"]);
    expect(
      rewriteTagList(["Design"], {
        kind: "rename",
        from: "design",
        to: "Design",
      })
    ).toBeNull();
  });

  test("merge keeps the casing the card already uses for the target", () => {
    expect(
      rewriteTagList(["ux", "Research"], {
        kind: "merge",
        from: "ux",
        to: "research",
      })
    ).toEqual(["Research"]);
    expect(
      rewriteTagList(["UX", "other"], {
        kind: "merge",
        from: "ux",
        to: "research",
      })
    ).toEqual(["research", "other"]);
  });

  test("delete removes every case variant", () => {
    expect(
      rewriteTagList(["Old", "keep", "OLD"], { kind: "delete", from: "old" })
    ).toEqual(["keep"]);
    expect(rewriteTagList(["old"], { kind: "delete", from: "old" })).toEqual(
      []
    );
  });

  test("handles emoji, RTL and CJK tags", () => {
    expect(
      rewriteTagList(["🎨 art", "تصميم", "设计"], {
        kind: "rename",
        from: "设计",
        to: "デザイン",
      })
    ).toEqual(["🎨 art", "تصميم", "デザイン"]);
  });
});

describe("tag names", () => {
  test("keys trim and lowercase", () => {
    expect(tagKey("  Design ")).toBe("design");
  });

  test("names must be non-empty and at most 64 characters", () => {
    expect(explainInvalidTagName(" ")).toBe("Name the tag");
    expect(explainInvalidTagName("x".repeat(64))).toBeNull();
    expect(explainInvalidTagName("x".repeat(65))).toBe(
      "Tags can be at most 64 characters"
    );
  });

  test("renaming onto an existing tag suggests a merge", () => {
    expect(tagExistsMessage(" web ")).toBe(
      'A tag named "web" already exists. Merge into it instead.'
    );
  });
});

describe("hidden tags", () => {
  test.each([
    [["secret"], true],
    [["Secret"], true],
    [[" HIDDEN "], true],
    [["work", "  hidden"], true],
    [["secrets", "hidden-ish", "hide"], false],
    [[], false],
    [undefined, false],
  ] as const)("%p hides a card: %p", (tags, hidden) => {
    expect(isHiddenTagList(tags)).toBe(hidden);
  });

  test("a card is hidden by its flag or its user tags, never by AI tags", () => {
    expect(isCardHidden({ isHidden: true, tags: [] })).toBe(true);
    expect(isCardHidden({ tags: ["Hidden"] })).toBe(true);
    expect(isCardHidden({ tags: ["work"] })).toBe(false);
    expect(
      isCardHidden({ tags: ["work"], aiTags: ["secret"] } as {
        tags: string[];
      })
    ).toBe(false);
  });
});

describe("card tag lists", () => {
  const tags = (count: number) =>
    Array.from({ length: count }, (_, index) => `tag-${index}`);

  test("trims, drops blanks and keeps the first of each case variant", () => {
    expect(normalizeTagList([" Design ", "", "design", "web", "  "])).toEqual([
      "Design",
      "web",
    ]);
  });

  test("refuses a tag over 64 characters", () => {
    expect(explainInvalidCardTags(["x".repeat(65)])).toBe(
      "Each tag must be at most 64 characters"
    );
    expect(explainInvalidCardTags(["x".repeat(64)])).toBeNull();
  });

  test("refuses growing a card past the tag limit but lets one already past it shrink", () => {
    expect(explainInvalidCardTags(tags(MAX_CARD_TAGS))).toBeNull();
    expect(explainInvalidCardTags(tags(MAX_CARD_TAGS + 1))).toBe(
      `A card can have at most ${MAX_CARD_TAGS} tags`
    );
    expect(
      explainInvalidCardTags(tags(MAX_CARD_TAGS + 5), MAX_CARD_TAGS + 6)
    ).toBeNull();
    expect(
      explainInvalidCardTags(tags(MAX_CARD_TAGS + 7), MAX_CARD_TAGS + 6)
    ).not.toBeNull();
  });
});
