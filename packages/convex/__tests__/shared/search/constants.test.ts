import { describe, expect, test } from "bun:test";
import {
  clampPageSize,
  clampSearchLimit,
  clampSearchOffset,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_CARD_LIMIT,
  SEARCH_MAX_OFFSET,
  SEARCH_MAX_PAGE_SIZE,
} from "../../../shared/search/constants";

describe("shared/search/constants clamp helpers", () => {
  describe("clampSearchLimit", () => {
    test("falls back to default when undefined", () => {
      expect(clampSearchLimit(undefined)).toBe(SEARCH_DEFAULT_LIMIT);
    });

    test("falls back to provided fallback when undefined", () => {
      expect(clampSearchLimit(undefined, 10)).toBe(10);
    });

    test("falls back to default for non-finite values", () => {
      expect(clampSearchLimit(Number.NaN)).toBe(SEARCH_DEFAULT_LIMIT);
      expect(clampSearchLimit(Number.POSITIVE_INFINITY)).toBe(
        SEARCH_DEFAULT_LIMIT
      );
    });

    test("clamps to the maximum card limit", () => {
      expect(clampSearchLimit(10_000)).toBe(SEARCH_MAX_CARD_LIMIT);
      expect(clampSearchLimit(SEARCH_MAX_CARD_LIMIT + 1)).toBe(
        SEARCH_MAX_CARD_LIMIT
      );
    });

    test("floors below 1 up to 1", () => {
      expect(clampSearchLimit(0)).toBe(1);
      expect(clampSearchLimit(-50)).toBe(1);
    });

    test("floors fractional values", () => {
      expect(clampSearchLimit(12.9)).toBe(12);
    });

    test("passes through valid values", () => {
      expect(clampSearchLimit(25)).toBe(25);
    });
  });

  describe("clampPageSize", () => {
    test("clamps to the max page size", () => {
      expect(clampPageSize(5000)).toBe(SEARCH_MAX_PAGE_SIZE);
    });

    test("collapses non-finite to 1", () => {
      expect(clampPageSize(Number.NaN)).toBe(1);
      expect(clampPageSize(Number.POSITIVE_INFINITY)).toBe(1);
    });

    test("collapses values below 1 to 1", () => {
      expect(clampPageSize(0)).toBe(1);
      expect(clampPageSize(-10)).toBe(1);
    });

    test("passes through valid values", () => {
      expect(clampPageSize(20)).toBe(20);
    });
  });

  describe("clampSearchOffset", () => {
    test("clamps to the max offset", () => {
      expect(clampSearchOffset(1_000_000)).toBe(SEARCH_MAX_OFFSET);
    });

    test("collapses negative or non-finite to 0", () => {
      expect(clampSearchOffset(-1)).toBe(0);
      expect(clampSearchOffset(Number.NaN)).toBe(0);
      expect(clampSearchOffset(Number.POSITIVE_INFINITY)).toBe(0);
    });

    test("floors fractional offsets", () => {
      expect(clampSearchOffset(42.7)).toBe(42);
    });

    test("passes through valid values", () => {
      expect(clampSearchOffset(100)).toBe(100);
    });
  });
});
