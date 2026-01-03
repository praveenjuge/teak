// @ts-nocheck
import { describe, expect, test } from "bun:test";
import {
  normalizeQuoteContent,
  applyQuoteDisplayFormatting,
  stripSurroundingQuotes,
} from "../convex/card/quoteFormatting";

describe("quoteFormatting", () => {
  describe("normalizeQuoteContent", () => {
    test("removes symmetric quotes", () => {
      expect(normalizeQuoteContent('"Hello"')).toEqual({
        text: "Hello",
        removedQuotes: true,
      });
    });

    test("removes smart quotes and preserves trailing attribution", () => {
      expect(normalizeQuoteContent("“Hello”—Ada")).toEqual({
        text: "Hello—Ada",
        removedQuotes: true,
      });
    });

    test("leaves content alone when closing quote is missing", () => {
      const original = "'Hello";
      expect(normalizeQuoteContent(original)).toEqual({
        text: original,
        removedQuotes: false,
      });
    });

    test("trims surrounding whitespace when quotes are removed", () => {
      expect(normalizeQuoteContent("  'Hello'  ")).toEqual({
        text: "Hello",
        removedQuotes: true,
      });
    });
  });

  describe("stripSurroundingQuotes", () => {
    test("returns original string when not quoted", () => {
      expect(stripSurroundingQuotes("Hello")).toBe("Hello");
    });

    test("removes nested quote layers", () => {
      expect(stripSurroundingQuotes("'“Hello”'")).toBe("Hello");
    });
  });

  describe("applyQuoteDisplayFormatting", () => {
    test("normalizes non-quote cards when quotes are removed", () => {
      const card = { type: "text", content: "'Hello'" };
      const result = applyQuoteDisplayFormatting(card);
      expect(result.content).toBe("Hello");
    });

    test("returns same card when no formatting is needed", () => {
      const card = { type: "text", content: "Hello" };
      const result = applyQuoteDisplayFormatting(card);
      expect(result).toBe(card);
    });
  });
});
