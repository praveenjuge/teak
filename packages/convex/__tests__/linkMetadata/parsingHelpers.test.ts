// @ts-nocheck
import { describe, expect, test } from "bun:test";
import {
  firstFromSources,
  sanitizeText,
  toSelectorMap,
} from "../../../convex/linkMetadata/parsing";

describe("parsing helpers", () => {
  test("sanitizeText trims and limits length", () => {
    const text = "  hello world  ";
    expect(sanitizeText(text, 5)).toBe("hello");
  });

  test("firstFromSources returns first valid entry", () => {
    const map = toSelectorMap([
      { selector: "one", results: [{ text: "" }] },
      { selector: "two", results: [{ text: "  value " }] },
    ]);
    const value = firstFromSources(map, [
      { selector: "one", attribute: "text" },
      { selector: "two", attribute: "text" },
    ]);
    expect(value).toBe("value");
  });
});
