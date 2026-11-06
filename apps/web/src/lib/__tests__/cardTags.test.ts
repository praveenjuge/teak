import { describe, expect, test } from "bun:test";
import {
  addTagToCard,
  explainInvalidTagEdit,
  parseTagList,
  tagsWithAdded,
  tagsWithout,
} from "../cardTags";

describe("adding a typed tag to a card", () => {
  test("keeps the case it was typed in, trimmed, as the server saves it", () => {
    expect(addTagToCard({ tags: ["design"] }, "  Web Dev ")).toEqual({
      hides: false,
      kind: "add",
      tag: "Web Dev",
      tags: ["design", "Web Dev"],
    });
  });

  test("names the tag the card already has, whatever its case", () => {
    expect(addTagToCard({ tags: ["Design"] }, "design")).toEqual({
      existing: "Design",
      kind: "exists",
    });
  });

  test("adds nothing for a blank tag", () => {
    expect(addTagToCard({ tags: [] }, "   ")).toEqual({ kind: "empty" });
  });

  test("refuses a tag longer than 64 characters with the server's reason", () => {
    expect(addTagToCard({ tags: [] }, "a".repeat(65))).toEqual({
      kind: "invalid",
      message: "Each tag must be at most 64 characters",
    });
  });

  test("says a hidden tag hides the card, unless it was hidden already", () => {
    expect(addTagToCard({ tags: [] }, "Secret")).toMatchObject({
      hides: true,
    });
    expect(
      addTagToCard({ isHidden: true, tags: ["hidden"] }, "secret")
    ).toMatchObject({ hides: false });
  });
});

describe("a bulk tag edit", () => {
  test("reads commas as separate tags, once each, in their typed case", () => {
    expect(parseTagList(" Design, later ,design,, Later")).toEqual([
      "Design",
      "later",
    ]);
  });

  test("adds after the tags a card has, keeping the one it has", () => {
    expect(tagsWithAdded(["Design"], ["design", "Later"])).toEqual([
      "Design",
      "Later",
    ]);
  });

  test("removes a tag whatever its case", () => {
    expect(tagsWithout(["Design", "Keep"], ["DESIGN"])).toEqual(["Keep"]);
  });

  test("checks length only when adding: removing names tags cards have", () => {
    const long = ["a".repeat(65)];
    expect(explainInvalidTagEdit(long, "add")).toEqual({ kind: "tooLong" });
    expect(explainInvalidTagEdit(long, "remove")).toBeNull();
  });

  test("names at most 20 tags at a time", () => {
    const tags = Array.from({ length: 21 }, (_, index) => `t${index}`);
    expect(explainInvalidTagEdit(tags, "remove")).toEqual({ kind: "tooMany" });
  });
});
