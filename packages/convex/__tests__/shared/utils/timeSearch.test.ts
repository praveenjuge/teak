import { describe, expect, test } from "bun:test";
import { parseTimeSearchQuery } from "../../../shared/utils/timeSearch";
import { loadFixture } from "../loadFixture.test-utils";

const fixture = loadFixture<{
  now: string;
  rows: { end: string | null; query: string; start: string | null }[];
}>("timeSearch");

const day = (timestamp: number) => {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

describe("parseTimeSearchQuery", () => {
  const now = new Date(fixture.now);

  test.each(fixture.rows)(
    "$query → $start to $end",
    ({ query, start, end }) => {
      const result = parseTimeSearchQuery(query, { now, weekStart: 0 });
      expect(
        result
          ? { start: day(result.range.start), end: day(result.range.end) }
          : null
      ).toEqual(start && end ? { start, end } : null);
    }
  );

  test.each([
    ["today", "Today"],
    ["yesterday", "Yesterday"],
    ["last week", "Last Week"],
    ["monday", "Monday"],
    ["last monday", "Last Monday"],
    ["June 2024", "Jun 2024"],
    ["June 5, 2024", "Jun 5, 2024"],
    ["2024-06-05", "Jun 5, 2024"],
    ["06/05/2024", "Jun 5, 2024"],
    ["2024", "2024"],
    ["June 2024 to July 2025", "Jun 2024 – Jul 2025"],
  ])("labels %p as %p", (query, label) => {
    expect(parseTimeSearchQuery(query, { now, weekStart: 0 })?.label).toBe(
      label
    );
  });
});
