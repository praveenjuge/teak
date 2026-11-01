import { describe, expect, test } from "bun:test";
import {
  detectCsvDelimiter,
  parseCsvRecords,
  parseCsvRows,
  readCsvTable,
} from "../../import/csv";
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

  test("a quote only opens a quoted cell at the start of the cell", () => {
    expect(parseCsvRows('a,5" screen,b\n1,2,3')).toEqual([
      ["a", '5" screen', "b"],
      ["1", "2", "3"],
    ]);
  });

  test("an unclosed quote ends with its line, and the row is flagged", () => {
    const records = parseCsvRecords(
      'url,title\n"https://e.test/a,title\nhttps://e.test/b,B\nhttps://e.test/c,C'
    );
    expect(records.rows).toEqual([
      ["url", "title"],
      ["https://e.test/a,title"],
      ["https://e.test/b", "B"],
      ["https://e.test/c", "C"],
    ]);
    expect(records.numbers).toEqual([1, 2, 3, 4]);
    expect([...records.problems]).toEqual([[1, "unclosed_quote"]]);
  });

  test("a closed multi-line cell before an unclosed quote stays one row", () => {
    const records = parseCsvRecords('a,"x\ny"\n\n"b\nc,d');
    expect(records.rows).toEqual([["a", "x\ny"], ["b"], ["c", "d"]]);
    expect(records.numbers).toEqual([1, 3, 4]);
    expect([...records.problems]).toEqual([[1, "unclosed_quote"]]);
  });

  test("quotes pair across lines, and only the odd one out is flagged", () => {
    const records = parseCsvRecords(`h\n${'"x\n'.repeat(5001)}`);
    expect(records.rows).toHaveLength(2502);
    expect(records.rows[1]).toEqual(["x\nx"]);
    expect(records.problems.get(2501)).toBe("unclosed_quote");
  });

  test("text after a closing quote stays in the cell and flags the row", () => {
    const records = parseCsvRecords('"a,"tail,b\n"c" ,d');
    expect(records.rows).toEqual([
      ["a,tail", "b"],
      ["c ", "d"],
    ]);
    expect([...records.problems]).toEqual([[0, "text_after_quote"]]);
  });

  test("reads semicolon and tab separators, and detects them from the header", () => {
    expect(parseCsvRows('a;"b;c"\n1;2', { delimiter: ";" })).toEqual([
      ["a", "b;c"],
      ["1", "2"],
    ]);
    expect(detectCsvDelimiter("url,title")).toBe(",");
    expect(detectCsvDelimiter("\n\nurl;title;tags")).toBe(";");
    expect(detectCsvDelimiter("url\ttitle")).toBe("\t");
    expect(detectCsvDelimiter('"a,b";c')).toBe(";");
    expect(detectCsvDelimiter("url")).toBe(",");
    expect(detectCsvDelimiter("url;title,x")).toBe(",");
  });

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
    expect(
      parseCsvRows("a\n".repeat(10_002), { maxRows: 20_000 })
    ).toHaveLength(10_002);
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

  test("folderPath keeps the deepest folders of a path too long for one name", () => {
    const name = folderPath([
      "a".repeat(200),
      "b".repeat(100),
      "Fonts",
      "Serif",
    ]);
    expect(name).toBe(`… / ${"b".repeat(100)} / Fonts / Serif`);
    expect(folderPath(["x".repeat(400)])).toBe("x".repeat(300));
    expect(Array.from(folderPath(["a", "😀".repeat(400)]) ?? "")).toHaveLength(
      300
    );
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
