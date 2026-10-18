import { describe, expect, test } from "bun:test";
import { MAX_CARD_TITLE_LENGTH, parseCardTitle } from "../../shared/cardTitle";

describe("parseCardTitle", () => {
  test("trims a title", () => {
    expect(parseCardTitle("  Reading list  ")).toEqual({
      kind: "title",
      title: "Reading list",
    });
  });

  test.each([null, "", "   "])("clears the title for %p", (value) => {
    expect(parseCardTitle(value)).toEqual({ kind: "clear" });
  });

  test.each([42, undefined, { title: "x" }])("refuses %p", (value) => {
    expect(parseCardTitle(value)).toEqual({ kind: "invalid" });
  });

  test("refuses a title past the length limit", () => {
    expect(parseCardTitle("a".repeat(MAX_CARD_TITLE_LENGTH + 1))).toEqual({
      kind: "invalid",
    });
    expect(parseCardTitle("a".repeat(MAX_CARD_TITLE_LENGTH))).toEqual({
      kind: "title",
      title: "a".repeat(MAX_CARD_TITLE_LENGTH),
    });
  });
});
