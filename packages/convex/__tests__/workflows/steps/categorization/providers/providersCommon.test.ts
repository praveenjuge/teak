// @ts-nocheck
import { describe, expect, test } from "bun:test";
import {
  formatCountString,
  formatDate,
  formatRating,
  getRawAttribute,
  getRawText,
  normalizeWhitespace,
} from "../../../../../../convex/workflows/steps/categorization/providers/common";

describe("categorization providers common", () => {
  test("normalizeWhitespace trims and collapses", () => {
    expect(normalizeWhitespace("  hello   world  ")).toBe("hello world");
  });

  test("getRawText returns normalized text", () => {
    const map = new Map([["meta", { text: "  value   here  " }]]);
    expect(getRawText(map, "meta")).toBe("value here");
  });

  test("getRawAttribute matches attributes case-insensitively", () => {
    const map = new Map([
      ["link", { attributes: [{ name: "HREF", value: "  /path  " }] }],
    ]);
    expect(getRawAttribute(map, "link", "href")).toBe("/path");
  });

  test("formatCountString handles abbreviated counts", () => {
    expect(formatCountString("1.2k stars")).toBe("1,200");
    expect(formatCountString("2m")).toBe("2,000,000");
  });

  test("formatRating formats numeric values", () => {
    expect(formatRating("4.5")).toBe("4.50");
    expect(formatRating("not a number")).toBe("not a number");
  });

  test("formatDate returns locale formatted date", () => {
    expect(formatDate("2024-01-05T00:00:00Z")).toBe("Jan 5, 2024");
  });
});
