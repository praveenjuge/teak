import { describe, expect, test } from "bun:test";
import {
  explainInvalidTagName,
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
