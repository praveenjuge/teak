import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CSV_HEADER_ALIASES,
  parseGenericCsv,
  splitCsvTags,
} from "../../import/genericCsv";
import { ImportLimitExceeded } from "../../import/sourceItems";
import { validateImportCard } from "../../import/validate";
import { IMPORT_FAILURE } from "../../shared/importSources";
import { urlKey } from "../../shared/utils/urlKey";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/csv/${name}`, import.meta.url), "utf8");

const parse = (name: string) => {
  const items = parseGenericCsv(fixture(name));
  for (const item of items) {
    if (item.card) {
      expect(() => validateImportCard(item.card)).not.toThrow();
    }
  }
  return items;
};

describe("parseGenericCsv", () => {
  test("a url-only CSV gives one link per row, titled by its URL", () => {
    const items = parse("minimal.csv");
    expect(items.map((item) => item.card)).toEqual([
      expect.objectContaining({
        type: "link",
        url: "https://example.com/minimal/one",
        content: "https://example.com/minimal/one",
      }),
      expect.objectContaining({ url: "https://example.com/minimal/two" }),
    ]);
    expect(items[0]?.card?.tags).toBeUndefined();
    expect(items[0]?.card?.folders).toBeUndefined();
    expect(items[0]?.card?.createdAt).toBeUndefined();
  });

  test("reads every column: title, tags, flattened folder, note and created", () => {
    const items = parse("full.csv");
    expect(items[0]?.card).toMatchObject({
      url: "https://example.com/full/one",
      content: "First link",
      tags: ["design", "type"],
      folders: ["Work / Design"],
      notes: "A note",
      createdAt: Date.parse("2024-05-01"),
    });
    expect(items[1]?.card).toMatchObject({
      tags: ["reading"],
      folders: ["Reading"],
      notes: 'Commas, and "quotes"',
      createdAt: Date.parse("2024-05-02T09:30"),
    });
    // Epoch seconds and milliseconds are the same moment.
    expect(items[2]?.card?.createdAt).toBe(1_714_521_600_000);
    expect(items[3]?.card?.createdAt).toBe(1_714_521_600_000);
  });

  test("common header aliases map to the same fields", () => {
    expect(parse("aliases.csv")[0]?.card).toMatchObject({
      url: "https://example.com/aliases/one",
      content: "Alias title",
      tags: ["alpha", "beta"],
      folders: ["Projects / Teak"],
      notes: "Alias note",
      createdAt: Date.parse("2024-05-01T10:00:00Z"),
    });
  });

  const aliasRows = (
    Object.entries(CSV_HEADER_ALIASES) as [string, readonly string[]][]
  ).flatMap(([field, aliases]) =>
    aliases.map((alias) => [field, alias] as const)
  );
  const sample: Record<string, string> = {
    title: "Named",
    tags: "x, y",
    folder: "Shelf",
    note: "Noted",
    created: "2024-01-02T03:04:05Z",
  };
  test.each(aliasRows)("%s is read from a %p column", (field, alias) => {
    const csv =
      field === "url"
        ? `${alias}\nhttps://example.com/alias`
        : `url,${alias}\nhttps://example.com/alias,"${sample[field]}"`;
    const card = parseGenericCsv(csv)[0]?.card;
    expect(card?.url).toBe("https://example.com/alias");
    const expected = {
      url: undefined,
      title: { content: "Named" },
      tags: { tags: ["x", "y"] },
      folder: { folders: ["Shelf"] },
      note: { notes: "Noted" },
      created: { createdAt: Date.parse("2024-01-02T03:04:05Z") },
    }[field];
    if (expected) {
      expect(card).toMatchObject(expected);
    }
  });

  test("headers match whatever their case, spacing, _ or -", () => {
    const card = parseGenericCsv(
      "  URL ,TITLE,Date_Added,saved-at\nhttps://example.com/odd,Odd,2024-05-01,"
    )[0]?.card;
    expect(card).toMatchObject({
      url: "https://example.com/odd",
      content: "Odd",
      createdAt: Date.parse("2024-05-01"),
    });
  });

  test("with two url columns the first wins; unknown columns are ignored", () => {
    const card = parseGenericCsv(
      "id,link,url,extra\n7,https://example.com/first,https://example.com/second,zzz"
    )[0]?.card;
    expect(card?.url).toBe("https://example.com/first");
    expect(card?.content).toBe("https://example.com/first");
  });

  test("tags split on commas, else on | or ;, with # dropped", () => {
    const items = parse("tags-pipe.csv");
    expect(items.map((item) => item.card?.tags)).toEqual([
      ["design", "type", "ux"],
      ["one", "two"],
      ["a", "b|c"],
    ]);
    expect(splitCsvTags("")).toEqual([""]);
  });

  test("quoted cells keep their commas, quotes and line breaks", () => {
    const items = parse("quoted-newlines.csv");
    expect(items).toHaveLength(2);
    expect(items[0]?.card).toMatchObject({
      content: "Title on two lines",
      notes: 'First line\nsecond line, with "quotes"',
    });
    expect(items[1]?.card?.url).toBe("https://example.com/after");
  });

  test("a byte order mark and CRLF line endings read like plain LF", () => {
    const items = parse("bom-crlf.csv");
    expect(items.map((item) => item.card?.content)).toEqual([
      "BOM row",
      "Second",
    ]);
    expect(items[0]?.card?.tags).toEqual(["a", "b"]);
  });

  test("rows without a usable link go to the report with their row number", () => {
    const items = parse("unsafe-urls.csv");
    expect(items.map((item) => item.error ?? item.card?.url)).toEqual([
      "Row 2: CSV link is unsafe: only http and https links can be imported",
      "Row 3: CSV link is unsafe: only http and https links can be imported",
      "Row 4 has no url",
      "https://example.com/safe",
    ]);
    expect(items[2]?.label).toBe("Row 4");
  });

  test("variants of one link parse as separate rows that share a URL key", () => {
    const items = parse("variants.csv");
    expect(items).toHaveLength(3);
    const keys = new Set(items.map((item) => urlKey(item.card?.url ?? "")));
    expect(keys.size).toBe(1);
  });

  test("a CSV without a url column fails with its own failure class", () => {
    expect(() => parseGenericCsv(fixture("no-url.csv"))).toThrow(
      IMPORT_FAILURE.MISSING_URL_COLUMN
    );
    // Semicolon-separated files have one column, so they fail the same way.
    expect(() =>
      parseGenericCsv("url;title\nhttps://example.com/semi;Semi")
    ).toThrow(IMPORT_FAILURE.MISSING_URL_COLUMN);
  });

  test("an empty file or a header with no rows is not a CSV export", () => {
    for (const text of ["", "﻿", "\n\n", "url,title\n", " , \n"]) {
      expect(() => parseGenericCsv(text)).toThrow(
        "This doesn't look like a CSV export"
      );
    }
  });

  test("allows 10,000 rows and refuses 10,001", () => {
    const rows = (count: number) =>
      [
        "url",
        ...Array.from(
          { length: count },
          (_, i) => `https://example.com/rows/${i}`
        ),
      ].join("\n");
    expect(parseGenericCsv(rows(10_000))).toHaveLength(10_000);
    expect(() => parseGenericCsv(rows(10_001))).toThrow(ImportLimitExceeded);
  });

  test("fuzz: truncated files throw or give valid items", () => {
    const text = fixture("full.csv") + fixture("quoted-newlines.csv");
    for (let cut = 0; cut <= text.length; cut += 3) {
      try {
        for (const item of parseGenericCsv(text.slice(0, cut))) {
          if (item.card) {
            expect(() => validateImportCard(item.card)).not.toThrow();
          } else {
            expect(item.error).toBeString();
          }
        }
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    }
  });
});
