import { describe, it, expect } from "bun:test";
import {
  normalizeWhitespace,
  getRawText,
  getRawAttribute,
  formatCountString,
  formatRating,
  formatDate,
  type RawSelectorMap,
  type RawSelectorEntry,
} from "./common";

describe("normalizeWhitespace", () => {
  it("should return undefined for undefined input", () => {
    expect(normalizeWhitespace(undefined)).toBeUndefined();
  });

  it("should return undefined for empty string", () => {
    expect(normalizeWhitespace("")).toBeUndefined();
  });

  it("should return undefined for whitespace only", () => {
    expect(normalizeWhitespace("   ")).toBeUndefined();
    expect(normalizeWhitespace("\t\n\r")).toBeUndefined();
    expect(normalizeWhitespace(" \t \n \r ")).toBeUndefined();
  });

  it("should normalize multiple spaces to single space", () => {
    expect(normalizeWhitespace("hello    world")).toBe("hello world");
    expect(normalizeWhitespace("a  b   c    d")).toBe("a b c d");
  });

  it("should normalize tabs to spaces", () => {
    expect(normalizeWhitespace("hello\tworld")).toBe("hello world");
    expect(normalizeWhitespace("a\t\tb")).toBe("a b");
  });

  it("should normalize newlines to spaces", () => {
    expect(normalizeWhitespace("hello\nworld")).toBe("hello world");
    expect(normalizeWhitespace("a\n\nb")).toBe("a b");
  });

  it("should normalize mixed whitespace", () => {
    expect(normalizeWhitespace("hello \t \n world")).toBe("hello world");
    expect(normalizeWhitespace("  \t\nhello\n\t  world\r\n  ")).toBe("hello world");
  });

  it("should trim leading and trailing whitespace", () => {
    expect(normalizeWhitespace("  hello world  ")).toBe("hello world");
    expect(normalizeWhitespace("\thello world\n")).toBe("hello world");
  });

  it("should preserve single spaces", () => {
    expect(normalizeWhitespace("hello world")).toBe("hello world");
  });

  it("should handle single word", () => {
    expect(normalizeWhitespace("hello")).toBe("hello");
    expect(normalizeWhitespace("  hello  ")).toBe("hello");
  });

  it("should handle special characters", () => {
    expect(normalizeWhitespace("hello,  world!")).toBe("hello, world!");
    expect(normalizeWhitespace("a-b  c_d")).toBe("a-b c_d");
  });
});

describe("getRawText", () => {
  it("should return undefined for empty map", () => {
    const map = new Map();
    expect(getRawText(map, "selector1")).toBeUndefined();
  });

  it("should return undefined for non-existent selector", () => {
    const map = new Map([["selector1", { text: "some text" }]]);
    expect(getRawText(map, "selector2")).toBeUndefined();
  });

  it("should return normalized text for valid selector", () => {
    const map: RawSelectorMap = new Map([
      ["selector1", { text: "  hello   world  " }],
    ]);
    expect(getRawText(map, "selector1")).toBe("hello world");
  });

  it("should return undefined if entry has no text property", () => {
    const map: RawSelectorMap = new Map([
      ["selector1", { attributes: [] }],
    ]);
    expect(getRawText(map, "selector1")).toBeUndefined();
  });

  it("should return undefined if text is empty after normalization", () => {
    const map: RawSelectorMap = new Map([
      ["selector1", { text: "   " }],
    ]);
    expect(getRawText(map, "selector1")).toBeUndefined();
  });

  it("should handle entry with both text and attributes", () => {
    const map: RawSelectorMap = new Map([
      ["selector1", { text: "some text", attributes: [{ name: "href", value: "/link" }] }],
    ]);
    expect(getRawText(map, "selector1")).toBe("some text");
  });
});

describe("getRawAttribute", () => {
  const createAttributes = (
    attrs: Array<{ name?: string; value?: string }>
  ): Array<{ name?: string; value?: string }> => attrs;

  it("should return undefined for empty map", () => {
    const map = new Map();
    expect(getRawAttribute(map, "selector1", "href")).toBeUndefined();
  });

  it("should return undefined for non-existent selector", () => {
    const map: RawSelectorMap = new Map([
      ["selector1", { attributes: createAttributes([{ name: "href", value: "/link" }]) }],
    ]);
    expect(getRawAttribute(map, "selector2", "href")).toBeUndefined();
  });

  it("should return undefined for entry without attributes", () => {
    const map: RawSelectorMap = new Map([
      ["selector1", { text: "some text" }],
    ]);
    expect(getRawAttribute(map, "selector1", "href")).toBeUndefined();
  });

  it("should return undefined for entry with empty attributes array", () => {
    const map: RawSelectorMap = new Map([
      ["selector1", { attributes: [] }],
    ]);
    expect(getRawAttribute(map, "selector1", "href")).toBeUndefined();
  });

  it("should return normalized attribute value for exact match", () => {
    const map: RawSelectorMap = new Map([
      ["selector1", { attributes: createAttributes([{ name: "href", value: "  /link  " }]) }],
    ]);
    expect(getRawAttribute(map, "selector1", "href")).toBe("/link");
  });

  it("should be case-insensitive for attribute name", () => {
    const map: RawSelectorMap = new Map([
      ["selector1", { attributes: createAttributes([{ name: "HREF", value: "/link" }]) }],
    ]);
    expect(getRawAttribute(map, "selector1", "href")).toBe("/link");
    expect(getRawAttribute(map, "selector1", "HREF")).toBe("/link");
    expect(getRawAttribute(map, "selector1", "HrEf")).toBe("/link");
  });

  it("should return undefined for non-matching attribute name", () => {
    const map: RawSelectorMap = new Map([
      ["selector1", { attributes: createAttributes([{ name: "src", value: "/image.png" }]) }],
    ]);
    expect(getRawAttribute(map, "selector1", "href")).toBeUndefined();
  });

  it("should skip attributes with undefined name", () => {
    const map: RawSelectorMap = new Map([
      ["selector1", { attributes: createAttributes([{ name: undefined, value: "test" }, { name: "href", value: "/link" }]) }],
    ]);
    expect(getRawAttribute(map, "selector1", "href")).toBe("/link");
  });

  it("should skip attributes with null name", () => {
    const map: RawSelectorMap = new Map([
      ["selector1", { attributes: createAttributes([{ name: null as any, value: "test" }, { name: "href", value: "/link" }]) }],
    ]);
    expect(getRawAttribute(map, "selector1", "href")).toBe("/link");
  });

  it("should handle attributes with undefined value", () => {
    const map: RawSelectorMap = new Map([
      ["selector1", { attributes: createAttributes([{ name: "href", value: undefined }]) }],
    ]);
    expect(getRawAttribute(map, "selector1", "href")).toBeUndefined();
  });

  it("should return first matching attribute", () => {
    const map: RawSelectorMap = new Map([
      ["selector1", { attributes: createAttributes([
        { name: "href", value: "/first" },
        { name: "href", value: "/second" }
      ])}],
    ]);
    expect(getRawAttribute(map, "selector1", "href")).toBe("/first");
  });
});

describe("formatCountString", () => {
  it("should return undefined for undefined input", () => {
    expect(formatCountString(undefined)).toBeUndefined();
  });

  it("should return undefined for empty string", () => {
    expect(formatCountString("")).toBeUndefined();
  });

  it("should return undefined for whitespace only", () => {
    expect(formatCountString("   ")).toBeUndefined();
  });

  it("should format simple number", () => {
    expect(formatCountString("100")).toBe("100");
    expect(formatCountString("1,000")).toBe("1,000");
    expect(formatCountString("10000")).toBe("10,000");
  });

  it("should format number with k suffix", () => {
    expect(formatCountString("1k")).toBe("1,000");
    expect(formatCountString("1.5k")).toBe("1,500");
    expect(formatCountString("10K")).toBe("10,000");
    expect(formatCountString("123k")).toBe("123,000");
    expect(formatCountString("1.23k")).toBe("1,230");
  });

  it("should format number with m suffix", () => {
    expect(formatCountString("1m")).toBe("1,000,000");
    expect(formatCountString("1.5M")).toBe("1,500,000");
    expect(formatCountString("10m")).toBe("10,000,000");
    expect(formatCountString("0.5m")).toBe("500,000");
  });

  it("should handle numbers with commas and decimals", () => {
    expect(formatCountString("1,234.56k")).toBe("1,234,560");
    expect(formatCountString("1.23M")).toBe("1,230,000");
  });

  it("should extract numeric token from text", () => {
    expect(formatCountString("about 1.5k stars")).toBe("1,500");
    expect(formatCountString("123k followers")).toBe("123,000");
  });

  it("should normalize whitespace for non-numeric strings", () => {
    expect(formatCountString("  hello   world  ")).toBe("hello world");
  });

  it("should return normalized string when no number found", () => {
    expect(formatCountString("many users")).toBe("many users");
  });

  it("should handle edge cases", () => {
    expect(formatCountString("0.1k")).toBe("100");
    expect(formatCountString("0.01m")).toBe("10,000");
    expect(formatCountString("1.0k")).toBe("1,000");
  });
});

describe("formatRating", () => {
  it("should return undefined for undefined input", () => {
    expect(formatRating(undefined)).toBeUndefined();
  });

  it("should return undefined for empty string", () => {
    expect(formatRating("")).toBeUndefined();
  });

  it("should format valid numeric string", () => {
    expect(formatRating("8.5")).toBe("8.50");
    expect(formatRating("9")).toBe("9.00");
    expect(formatRating("7.123")).toBe("7.12");
  });

  it("should normalize whitespace for non-numeric strings", () => {
    expect(formatRating("  good   rating  ")).toBe("good rating");
  });

  it("should return normalized string for NaN values", () => {
    expect(formatRating("not a number")).toBe("not a number");
    expect(formatRating("abc")).toBe("abc");
  });

  it("should handle rounding correctly", () => {
    expect(formatRating("8.567")).toBe("8.57");
    expect(formatRating("8.564")).toBe("8.56");
    expect(formatRating("8.565")).toBe("8.56");
  });

  it("should handle edge cases", () => {
    expect(formatRating("0")).toBe("0.00");
    expect(formatRating("10")).toBe("10.00");
    expect(formatRating(".5")).toBe("0.50");
  });
});

describe("formatDate", () => {
  it("should return undefined for undefined input", () => {
    expect(formatDate(undefined)).toBeUndefined();
  });

  it("should return undefined for empty string", () => {
    expect(formatDate("")).toBeUndefined();
  });

  it("should format ISO date string", () => {
    const result = formatDate("2023-12-25T00:00:00Z");
    expect(result).toBeDefined();
    expect(result).toContain("Dec");
    expect(result).toContain("25");
    expect(result).toContain("2023");
  });

  it("should format RFC 2822 date string", () => {
    const result = formatDate("Mon, 25 Dec 2023 00:00:00 GMT");
    expect(result).toBeDefined();
    expect(result).toContain("Dec");
    expect(result).toContain("25");
  });

  it("should return undefined for invalid date", () => {
    expect(formatDate("not a date")).toBeUndefined();
    expect(formatDate("999-99-99")).toBeUndefined();
  });

  it("should handle various date formats", () => {
    expect(formatDate("2023-12-25")).toBeDefined();
    expect(formatDate("December 25, 2023")).toBeDefined();
  });

  it("should format dates consistently", () => {
    const result1 = formatDate("2023-01-15");
    const result2 = formatDate("2023-01-15");
    expect(result1).toBe(result2);
  });

  it("should include month, day, and year", () => {
    const result = formatDate("2023-05-10");
    expect(result).toMatch(/\w+ \d+, \d{4}/);
  });

  it("should handle leap year dates", () => {
    expect(formatDate("2020-02-29")).toBeDefined();
  });

  it("should handle edge cases", () => {
    expect(formatDate("1970-01-01")).toBeDefined();
    expect(formatDate("2099-12-31")).toBeDefined();
  });
});
