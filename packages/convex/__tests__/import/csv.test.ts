import { describe, expect, test } from "bun:test";
import { parseCsvRows, readCsvTable } from "../../import/csv";
import {
  cleanTags,
  folderPath,
  parseSourceDate,
} from "../../import/sourceItems";

describe("shared CSV reader", () => {
  const cases: [string, string[][]][] = [
    [
      "a,b\n1,2",
      [
        ["a", "b"],
        ["1", "2"],
      ],
    ],
    [
      "a,b\r\n1,2\r\n",
      [
        ["a", "b"],
        ["1", "2"],
      ],
    ],
    ["a\r1", [["a"], ["1"]]],
    ['"x, y","say ""hi"""', [["x, y", 'say "hi"']]],
    ['"line\none",2', [["line\none", "2"]]],
    ["a,,c", [["a", "", "c"]]],
    [
      "a,b\n\n1,2",
      [
        ["a", "b"],
        ["1", "2"],
      ],
    ],
  ];
  for (const [input, rows] of cases) {
    test(`parses ${JSON.stringify(input)}`, () => {
      expect(parseCsvRows(input)).toEqual(rows);
    });
  }

  test("matches columns by name, ignoring case and order; strips a BOM", () => {
    const table = readCsvTable("﻿Title,URL,Extra\nA,https://a.test,x\n\n");
    expect(table.has("url")).toBe(true);
    expect(table.has("missing")).toBe(false);
    expect(table.rows).toHaveLength(1);
    expect(table.cell(table.rows[0] ?? [], "title")).toBe("A");
    expect(table.cell(table.rows[0] ?? [], "missing")).toBe("");
  });

  test("an empty file has no header", () => {
    expect(() => readCsvTable("")).toThrow("CSV is empty");
  });

  test("refuses more than 256 columns or 10,000 rows", () => {
    expect(() => parseCsvRows(",".repeat(256))).toThrow("too many columns");
    expect(() => parseCsvRows("a\n".repeat(10_002))).toThrow(
      "exceeds 10,000 rows"
    );
  });
});

describe("source item helpers", () => {
  test("cleanTags trims, dedupes, drops blanks and long tags, caps at 50", () => {
    expect(cleanTags([" a ", "a", "", "x".repeat(65), "b"])).toEqual([
      "a",
      "b",
    ]);
    expect(cleanTags([])).toBeUndefined();
    expect(
      cleanTags(Array.from({ length: 80 }, (_, i) => `t${i}`))
    ).toHaveLength(50);
  });

  test("folderPath joins nested names with ' / '", () => {
    expect(folderPath(["Work", " Design  System ", ""])).toBe(
      "Work / Design System"
    );
    expect(folderPath(["", " "])).toBeUndefined();
  });

  test("parseSourceDate reads seconds, milliseconds and ISO-like dates", () => {
    expect(parseSourceDate("1700000000")).toBe(1_700_000_000_000);
    expect(parseSourceDate(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(parseSourceDate("2024-03-01 10:30:00+00:00")).toBe(
      Date.parse("2024-03-01T10:30:00+00:00")
    );
    expect(parseSourceDate("not a date")).toBeUndefined();
    expect(parseSourceDate("0")).toBeUndefined();
    expect(parseSourceDate("")).toBeUndefined();
  });
});
