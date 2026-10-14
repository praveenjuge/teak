import { describe, expect, test } from "bun:test";
import { buildCardsCsv, CSV_COLUMNS, csvCell } from "../../export/csv";
import { type SerializedCard, toDualTimestamp } from "../../export/serialize";
import { parseCsvRows } from "../../import/raindrop";

const card = (overrides: Partial<SerializedCard> = {}): SerializedCard => ({
  id: "card_1",
  type: "link",
  content: "Saved page",
  url: "https://example.com/a?b=1&c=2",
  tags: ["design"],
  aiTags: ["ui", "web"],
  folders: ["Reading"],
  isFavorited: false,
  isArchived: false,
  createdAt: toDualTimestamp(Date.UTC(2026, 9, 1)),
  updatedAt: toDualTimestamp(Date.UTC(2026, 9, 2)),
  ...overrides,
});

/** The cell as written: an apostrophe before a formula start. */
const guarded = (value: string) =>
  /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

const parse = (csv: string) => {
  expect(csv.startsWith("﻿")).toBe(true);
  return parseCsvRows(csv.slice(1));
};

// A small seeded generator so the fuzz cases are the same on every run.
const seeded = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
};

const PIECES = [
  '"',
  ",",
  "\r\n",
  "\n",
  "\r",
  "=",
  "+",
  "-",
  "@",
  "\t",
  " ",
  "'",
  "a",
  "Z",
  "😀",
  "👩‍👩‍👧",
  "مرحبا",
  "日本語",
  "<script>",
  '=HYPERLINK("http://x")',
  "​",
];

const randomText = (random: () => number) => {
  let text = "";
  const length = Math.floor(random() * 12);
  for (let index = 0; index < length; index++) {
    text += PIECES[Math.floor(random() * PIECES.length)];
  }
  return text;
};

describe("buildCardsCsv", () => {
  test("writes a BOM, a header and CRLF rows", () => {
    const csv = buildCardsCsv([card()]);
    expect(csv.startsWith('﻿"id","type","title"')).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    const rows = parse(csv);
    expect(rows[0]).toEqual([...CSV_COLUMNS]);
    expect(rows[1]).toEqual([
      "card_1",
      "link",
      "",
      "https://example.com/a?b=1&c=2",
      "Saved page",
      "",
      "design",
      "ui, web",
      "",
      "Reading",
      "false",
      "false",
      "2026-10-01T00:00:00.000Z",
    ]);
  });

  test("an empty library is just the header", () => {
    const rows = parse(buildCardsCsv([]));
    expect(rows).toEqual([[...CSV_COLUMNS]]);
  });

  test("guards cells a spreadsheet would run as formulas", () => {
    const cases: [string, string][] = [
      ["=1+1", '"\'=1+1"'],
      ['=HYPERLINK("http://x","y")', '"\'=HYPERLINK(""http://x"",""y"")"'],
      ["+1", '"\'+1"'],
      ["-1", '"\'-1"'],
      ["@SUM(A1)", '"\'@SUM(A1)"'],
      ["\t=1", '"\'\t=1"'],
      ["\r=1", '"\'\r=1"'],
      ["a=1", '"a=1"'],
      [" =1", '" =1"'],
      ["", '""'],
    ];
    for (const [value, written] of cases) {
      expect(csvCell(value)).toBe(written);
    }
  });

  test("keeps quotes, commas, newlines, emoji, RTL and CJK", () => {
    const ugly = card({
      metadataTitle: 'He said "hi", then\nleft',
      content: "line one\r\nline two, with a comma",
      notes: "مرحبا 日本語 😀",
      tags: ["a,b", "c"],
      folders: ["Folder, with comma", "Ünïcödé"],
      aiSummary: "<script>alert(1)</script>",
      isFavorited: true,
      isArchived: true,
    });
    const [, row] = parse(buildCardsCsv([ugly]));
    expect(row?.[2]).toBe('He said "hi", then\nleft');
    expect(row?.[4]).toBe("line one\r\nline two, with a comma");
    expect(row?.[5]).toBe("مرحبا 日本語 😀");
    expect(row?.[6]).toBe("a,b, c");
    expect(row?.[8]).toBe("<script>alert(1)</script>");
    expect(row?.[9]).toBe("Folder, with comma, Ünïcödé");
    expect(row?.[10]).toBe("true");
    expect(row?.[11]).toBe("true");
  });

  test("fuzz: every row parses back to its cells", () => {
    const random = seeded(11);
    const cards: SerializedCard[] = [];
    for (let index = 0; index < 300; index++) {
      cards.push(
        card({
          id: `card_${index}`,
          metadataTitle: randomText(random),
          content: randomText(random),
          notes: randomText(random),
          aiSummary: randomText(random),
          url: `https://example.com/${index}`,
        })
      );
    }
    const rows = parse(buildCardsCsv(cards));
    expect(rows).toHaveLength(cards.length + 1);
    for (const [index, source] of cards.entries()) {
      const row = rows[index + 1] ?? [];
      expect(row).toHaveLength(CSV_COLUMNS.length);
      expect(row[2]).toBe(guarded(source.metadataTitle ?? ""));
      expect(row[4]).toBe(guarded(source.content));
      expect(row[5]).toBe(guarded(source.notes ?? ""));
      expect(row[8]).toBe(guarded(source.aiSummary ?? ""));
      for (const cell of row) {
        expect(/^[=+\-@\t\r]/.test(cell)).toBe(false);
      }
    }
  });
});
