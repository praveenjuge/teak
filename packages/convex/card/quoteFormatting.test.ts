import { describe, it, expect } from "bun:test";
import {
  normalizeQuoteContent,
  stripSurroundingQuotes,
  type QuoteNormalizationResult,
} from "./quoteFormatting";

// Mock Doc type for testing
type MockCard = {
  type: "quote" | "text" | "link";
  content?: string | null;
};

describe("normalizeQuoteContent", () => {
  describe("basic quote removal", () => {
    it("should remove double quotes", () => {
      const result = normalizeQuoteContent('"Hello world"');
      expect(result.text).toBe("Hello world");
      expect(result.removedQuotes).toBe(true);
    });

    it("should remove single quotes", () => {
      const result = normalizeQuoteContent("'Hello world'");
      expect(result.text).toBe("Hello world");
      expect(result.removedQuotes).toBe(true);
    });

    it("should remove backticks", () => {
      const result = normalizeQuoteContent("`Hello world`");
      expect(result.text).toBe("Hello world");
      expect(result.removedQuotes).toBe(true);
    });

    it("should remove fancy double quotes", () => {
      const result = normalizeQuoteContent("\u201CHello world\u201D");
      expect(result.text).toBe("Hello world");
      expect(result.removedQuotes).toBe(true);
    });

    it("should remove fancy single quotes", () => {
      const result = normalizeQuoteContent("\u2018Hello world\u2019");
      expect(result.text).toBe("Hello world");
      expect(result.removedQuotes).toBe(true);
    });

    it("should remove guillemets", () => {
      const result = normalizeQuoteContent("«Hello world»");
      expect(result.text).toBe("Hello world");
      expect(result.removedQuotes).toBe(true);
    });

    it("should remove Japanese-style quotes", () => {
      const result = normalizeQuoteContent("「Hello world」");
      expect(result.text).toBe("Hello world");
      expect(result.removedQuotes).toBe(true);
    });

    it("should remove corner brackets", () => {
      const result = normalizeQuoteContent("〈Hello world〉");
      expect(result.text).toBe("Hello world");
      expect(result.removedQuotes).toBe(true);
    });
  });

  describe("with trailing punctuation", () => {
    it("should preserve trailing punctuation after closing quote", () => {
      const result = normalizeQuoteContent('"Hello world".');
      expect(result.text).toBe("Hello world.");
      expect(result.removedQuotes).toBe(true);
    });

    it("should preserve trailing comma (if inside the quote)", () => {
      const result = normalizeQuoteContent('"Hello world", he said');
      // Comma is inside the quote's closing index, so it's removed
      expect(result.text).toBe('"Hello world", he said');
      expect(result.removedQuotes).toBe(false);
    });

    it("should preserve trailing exclamation", () => {
      const result = normalizeQuoteContent('"Hello world"!');
      expect(result.text).toBe("Hello world!");
    });

    it("should preserve trailing question mark", () => {
      const result = normalizeQuoteContent('"Hello world"?');
      expect(result.text).toBe("Hello world?");
    });

    it("should preserve multiple trailing punctuation marks", () => {
      const result = normalizeQuoteContent('"Hello world"...');
      expect(result.text).toBe("Hello world...");
    });

    it("should preserve ellipsis", () => {
      const result = normalizeQuoteContent('"Hello world"…');
      expect(result.text).toBe("Hello world…");
    });
  });

  describe("with trailing attribution", () => {
    it("should preserve em dash attribution", () => {
      const result = normalizeQuoteContent('"Hello world" — Author');
      expect(result.text).toBe("Hello world — Author");
    });

    it("should preserve en dash attribution", () => {
      const result = normalizeQuoteContent('"Hello world" - Author');
      expect(result.text).toBe("Hello world - Author");
    });

    it("should preserve horizontal bar attribution", () => {
      const result = normalizeQuoteContent('"Hello world" ― Author');
      expect(result.text).toBe("Hello world ― Author");
    });

    it("should preserve tilde attribution", () => {
      const result = normalizeQuoteContent('"Hello world" ~ Author');
      expect(result.text).toBe("Hello world ~ Author");
    });

    it("should preserve parenthetical attribution", () => {
      const result = normalizeQuoteContent('"Hello world" (Author)');
      expect(result.text).toBe("Hello world (Author)");
    });

    it("should preserve bracketed attribution", () => {
      const result = normalizeQuoteContent('"Hello world" [Author]');
      expect(result.text).toBe("Hello world [Author]");
    });

    it("should preserve curly brace attribution", () => {
      const result = normalizeQuoteContent('"Hello world" {Author}');
      expect(result.text).toBe("Hello world {Author}");
    });
  });

  describe("nested quotes", () => {
    it("should remove nested double quote layers", () => {
      const result = normalizeQuoteContent('""Hello world""');
      expect(result.text).toBe("Hello world");
      expect(result.removedQuotes).toBe(true);
    });

    it("should remove nested single quote layers", () => {
      const result = normalizeQuoteContent("''Hello world''");
      expect(result.text).toBe("Hello world");
      expect(result.removedQuotes).toBe(true);
    });

    it("should remove mixed quote layers", () => {
      const result = normalizeQuoteContent('\'"Hello world"\'');
      expect(result.text).toBe("Hello world");
      expect(result.removedQuotes).toBe(true);
    });

    it("should remove triple nested quotes", () => {
      const result = normalizeQuoteContent('"""Hello world"""');
      expect(result.text).toBe("Hello world");
      expect(result.removedQuotes).toBe(true);
    });
  });

  describe("asymmetric quotes", () => {
    it("should remove asymmetric opening and closing quotes", () => {
      const result = normalizeQuoteContent('"Hello world"');
      expect(result.text).toBe("Hello world");
      expect(result.removedQuotes).toBe(true);
    });

    it("should remove corner bracket style", () => {
      const result = normalizeQuoteContent("『Hello world』");
      expect(result.text).toBe("Hello world");
      expect(result.removedQuotes).toBe(true);
    });

    it("should remove angle bracket style", () => {
      const result = normalizeQuoteContent("《Hello world》");
      expect(result.text).toBe("Hello world");
      expect(result.removedQuotes).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should return original for empty string", () => {
      const result = normalizeQuoteContent("");
      expect(result.text).toBe("");
      expect(result.removedQuotes).toBe(false);
    });

    it("should return original for null input", () => {
      const result = normalizeQuoteContent(null);
      expect(result.text).toBe("");
      expect(result.removedQuotes).toBe(false);
    });

    it("should return original for undefined input", () => {
      const result = normalizeQuoteContent(undefined);
      expect(result.text).toBe("");
      expect(result.removedQuotes).toBe(false);
    });

    it("should return original for single character", () => {
      const result = normalizeQuoteContent("a");
      expect(result.text).toBe("a");
      expect(result.removedQuotes).toBe(false);
    });

    it("should return original for unmatched opening quote", () => {
      const result = normalizeQuoteContent('"Hello world');
      expect(result.text).toBe('"Hello world');
      expect(result.removedQuotes).toBe(false);
    });

    it("should return original for unmatched closing quote", () => {
      const result = normalizeQuoteContent('Hello world"');
      expect(result.text).toBe('Hello world"');
      expect(result.removedQuotes).toBe(false);
    });

    it("should trim whitespace before processing", () => {
      const result = normalizeQuoteContent('  "Hello world"  ');
      expect(result.text).toBe("Hello world");
      expect(result.removedQuotes).toBe(true);
    });

    it("should handle text without quotes", () => {
      const result = normalizeQuoteContent("Hello world");
      expect(result.text).toBe("Hello world");
      expect(result.removedQuotes).toBe(false);
    });

    it("should handle quotes with internal quotes", () => {
      const result = normalizeQuoteContent('"He said \\"hello\\" to me"');
      // The escaped quotes are part of the string content, not actual quote characters
      expect(result.text).toBe('He said \\"hello\\" to me');
      expect(result.removedQuotes).toBe(true);
    });
  });

  describe("complex real-world examples", () => {
    it("should handle quote with citation", () => {
      const result = normalizeQuoteContent(
        '"The only thing we have to fear is fear itself." — FDR'
      );
      expect(result.text).toBe("The only thing we have to fear is fear itself. — FDR");
      expect(result.removedQuotes).toBe(true);
    });

    it("should handle Chinese quotation marks", () => {
      const result = normalizeQuoteContent("「你好世界」");
      expect(result.text).toBe("你好世界");
      expect(result.removedQuotes).toBe(true);
    });

    it("should handle French guillemets with punctuation", () => {
      const result = normalizeQuoteContent("« Bonjour le monde », dit-il.");
      // Guillemets with trailing comma inside - comma is part of the closing quote content
      expect(result.text).toBe("« Bonjour le monde », dit-il.");
      expect(result.removedQuotes).toBe(false);
    });

    it("should handle nested decorative quotes", () => {
      const result = normalizeQuoteContent("「『Hello world』」");
      expect(result.text).toBe("Hello world");
    });

    it("should preserve content when no valid quotes found", () => {
      const result = normalizeQuoteContent(
        "This is just regular text without quotes."
      );
      expect(result.text).toBe("This is just regular text without quotes.");
      expect(result.removedQuotes).toBe(false);
    });

    it("should handle quote at end with trailing text and punctuation", () => {
      const result = normalizeQuoteContent('"Hello" (2024)');
      expect(result.text).toBe("Hello (2024)");
    });

    it("should handle quote followed by comma and space", () => {
      const result = normalizeQuoteContent('"Hello", world');
      // Comma is after the closing quote, so quotes are removed
      expect(result.text).toBe('"Hello", world');
      expect(result.removedQuotes).toBe(false);
    });
  });
});

describe("stripSurroundingQuotes", () => {
  it("should return normalized text directly", () => {
    expect(stripSurroundingQuotes('"Hello world"')).toBe("Hello world");
    expect(stripSurroundingQuotes("'Hello world'")).toBe("Hello world");
    expect(stripSurroundingQuotes("`Hello world`")).toBe("Hello world");
  });

  it("should return original if no quotes found", () => {
    expect(stripSurroundingQuotes("Hello world")).toBe("Hello world");
  });

  it("should return empty string for null input", () => {
    expect(stripSurroundingQuotes(null as any)).toBe("");
  });

  it("should return empty string for undefined input", () => {
    expect(stripSurroundingQuotes(undefined as any)).toBe("");
  });
});
