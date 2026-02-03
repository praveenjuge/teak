// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { parseTimeSearchQuery } from "./timeSearch";

const toParts = (timestamp: number) => {
  const date = new Date(timestamp);
  return [date.getFullYear(), date.getMonth(), date.getDate()];
};

const getRangeParts = (range: { start: number; end: number }) => ({
  start: toParts(range.start),
  end: toParts(range.end),
});

describe("parseTimeSearchQuery", () => {
  const now = new Date(2026, 1, 3, 12, 0, 0); // Feb 3, 2026

  test("parses today", () => {
    const result = parseTimeSearchQuery("today", { now, weekStart: 0 });
    expect(result?.label).toBe("Today");
    expect(getRangeParts(result!.range)).toEqual({
      start: [2026, 1, 3],
      end: [2026, 1, 4],
    });
  });

  test("parses yesterday", () => {
    const result = parseTimeSearchQuery("yesterday", { now, weekStart: 0 });
    expect(result?.label).toBe("Yesterday");
    expect(getRangeParts(result!.range)).toEqual({
      start: [2026, 1, 2],
      end: [2026, 1, 3],
    });
  });

  test("parses last week", () => {
    const result = parseTimeSearchQuery("last week", { now, weekStart: 0 });
    expect(result?.label).toBe("Last Week");
    expect(getRangeParts(result!.range)).toEqual({
      start: [2026, 0, 25],
      end: [2026, 1, 1],
    });
  });

  test("parses weekday", () => {
    const result = parseTimeSearchQuery("monday", { now, weekStart: 0 });
    expect(result?.label).toBe("Monday");
    expect(getRangeParts(result!.range)).toEqual({
      start: [2026, 1, 2],
      end: [2026, 1, 3],
    });
  });

  test("parses last weekday", () => {
    const result = parseTimeSearchQuery("last monday", { now, weekStart: 0 });
    expect(result?.label).toBe("Last Monday");
    expect(getRangeParts(result!.range)).toEqual({
      start: [2026, 0, 26],
      end: [2026, 0, 27],
    });
  });

  test("parses explicit month", () => {
    const result = parseTimeSearchQuery("June 2024", { now, weekStart: 0 });
    expect(result?.label).toBe("Jun 2024");
    expect(getRangeParts(result!.range)).toEqual({
      start: [2024, 5, 1],
      end: [2024, 6, 1],
    });
  });

  test("parses explicit date", () => {
    const result = parseTimeSearchQuery("June 5, 2024", {
      now,
      weekStart: 0,
    });
    expect(result?.label).toBe("Jun 5, 2024");
    expect(getRangeParts(result!.range)).toEqual({
      start: [2024, 5, 5],
      end: [2024, 5, 6],
    });
  });

  test("parses ISO date", () => {
    const result = parseTimeSearchQuery("2024-06-05", { now, weekStart: 0 });
    expect(result?.label).toBe("Jun 5, 2024");
    expect(getRangeParts(result!.range)).toEqual({
      start: [2024, 5, 5],
      end: [2024, 5, 6],
    });
  });

  test("parses US date", () => {
    const result = parseTimeSearchQuery("06/05/2024", { now, weekStart: 0 });
    expect(result?.label).toBe("Jun 5, 2024");
    expect(getRangeParts(result!.range)).toEqual({
      start: [2024, 5, 5],
      end: [2024, 5, 6],
    });
  });

  test("parses year", () => {
    const result = parseTimeSearchQuery("2024", { now, weekStart: 0 });
    expect(result?.label).toBe("2024");
    expect(getRangeParts(result!.range)).toEqual({
      start: [2024, 0, 1],
      end: [2025, 0, 1],
    });
  });

  test("parses range", () => {
    const result = parseTimeSearchQuery("June 2024 to July 2025", {
      now,
      weekStart: 0,
    });
    expect(result?.label).toBe("Jun 2024 – Jul 2025");
    expect(getRangeParts(result!.range)).toEqual({
      start: [2024, 5, 1],
      end: [2025, 7, 1],
    });
  });
});
