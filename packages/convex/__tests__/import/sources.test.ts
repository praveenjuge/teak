import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseInstapaperCsv } from "../../import/instapaper";
import { parseLinkwardenJson } from "../../import/linkwarden";
import { parseMymindCsv } from "../../import/mymind";
import { omnivoreItem, parseOmnivoreJson } from "../../import/omnivore";
import { parseOneTabText } from "../../import/onetab";
import { parsePocketExport } from "../../import/pocket";
import { parseReaderTags, parseReadwiseCsv } from "../../import/readwise";
import { parseImportSource } from "../../import/sources";
import { validateImportCard } from "../../import/validate";
import {
  describeImportFailure,
  IMPORT_MODES,
  importMaxBytes,
} from "../../shared/importSources";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const expectValidCards = (items: ReturnType<typeof parsePocketExport>) => {
  for (const item of items) {
    if (item.card) {
      expect(() => validateImportCard(item.card)).not.toThrow();
    }
  }
};

describe("Pocket", () => {
  test("CSV: titles, pipe tags, archive status, saved date; extra columns ignored", () => {
    const items = parsePocketExport(fixture("pocket.csv"));
    expect(items).toHaveLength(3);
    expect(items[0]?.card).toMatchObject({
      type: "link",
      content: 'Why "Tabs" Win, Mostly',
      url: "https://example.com/tabs",
      tags: ["design", "ux"],
      createdAt: 1_700_000_000_000,
    });
    expect(items[0]?.card?.isArchived).toBeUndefined();
    expect(items[1]?.card?.isArchived).toBe(true);
    expect(items[1]?.card?.tags).toBeUndefined();
    expect(items[2]?.error).toContain("only http and https");
    expectValidCards(items);
  });

  test("older HTML export: Unread and Read Archive sections", () => {
    const items = parsePocketExport(fixture("pocket.html"));
    expect(items.map((item) => item.card?.content)).toEqual([
      "Unread & new",
      "Old read",
    ]);
    expect(items[0]?.card).toMatchObject({
      tags: ["design", "fonts"],
      createdAt: 1_700_000_000_000,
    });
    expect(items[0]?.card?.isArchived).toBeUndefined();
    expect(items[1]?.card?.isArchived).toBe(true);
  });

  test("a CSV without url and time_added is not a Pocket export", () => {
    expect(() => parsePocketExport("name,link\nA,https://a.test")).toThrow(
      "doesn't look like a Pocket export"
    );
    expect(() => parsePocketExport("<html><p>hi</p></html>")).toThrow("Pocket");
  });
});

describe("Instapaper", () => {
  test("Starred, Archive, own folders, JSON tags, selection as note", () => {
    const items = parseInstapaperCsv(fixture("instapaper.csv"));
    expect(items[0]?.card).toMatchObject({
      content: "Starred article",
      isFavorited: true,
      notes: 'A highlighted, quoted "line"',
      tags: ["design", "typography"],
      createdAt: 1_700_000_000_000,
    });
    expect(items[0]?.card?.folders).toBeUndefined();
    expect(items[1]?.card?.isArchived).toBe(true);
    expect(items[2]?.card?.folders).toEqual(["Reading list"]);
    expect(items[3]?.card?.folders).toBeUndefined();
    expect(items[3]?.card?.isArchived).toBeUndefined();
    expect(items[4]?.error).toContain("unsafe");
    expectValidCards(items);
  });

  test("a CSV without a Folder column is not an Instapaper export", () => {
    expect(() => parseInstapaperCsv("URL,Title\nhttps://a.test,A")).toThrow(
      "Instapaper"
    );
  });
});

describe("Readwise Reader", () => {
  test("skips feed items; archive and shortlist; Python-style tags; BOM and CRLF", () => {
    const items = parseReadwiseCsv(fixture("readwise.csv"));
    expect(items.map((item) => item.card?.content)).toEqual([
      "Archived essay",
      "Shortlisted",
      "Later",
      "Tagged for shortlist",
    ]);
    expect(items[0]?.card).toMatchObject({
      isArchived: true,
      tags: ["design", "it's fine"],
      createdAt: Date.parse("2024-03-01T10:30:00+00:00"),
    });
    expect(items[1]?.card?.isFavorited).toBe(true);
    expect(items[2]?.card?.tags).toEqual(["later"]);
    expect(items[2]?.card?.isFavorited).toBeUndefined();
    expect(items[3]?.card?.isFavorited).toBe(true);
    expectValidCards(items);
  });

  test("feed rows don't count toward the 10,000-item limit", () => {
    const header = "Title,URL,Location";
    const feed = Array.from(
      { length: 10_500 },
      (_, i) => `F${i},https://a.test/f${i},feed`
    );
    const items = parseReadwiseCsv(
      [header, ...feed, "Kept,https://a.test/kept,later"].join("\n")
    );
    expect(items.map((item) => item.card?.content)).toEqual(["Kept"]);
    const saved = Array.from(
      { length: 10_001 },
      (_, i) => `S${i},https://a.test/s${i},new`
    );
    expect(() => parseReadwiseCsv([header, ...saved].join("\n"))).toThrow(
      "exceeds 10,000 items"
    );
  });

  test("reads quoted tags with escapes", () => {
    expect(parseReaderTags(`['a', "b's", 'c\\'d']`)).toEqual([
      "a",
      "b's",
      "c'd",
    ]);
    expect(parseReaderTags("[]")).toEqual([]);
  });

  test("a CSV without Location is not a Reader export", () => {
    expect(() => parseReadwiseCsv("Title,URL\nA,https://a.test")).toThrow(
      "Readwise Reader"
    );
  });
});

describe("mymind", () => {
  test("links, text-only cards as notes, empty cards fail on their own", () => {
    const items = parseMymindCsv(fixture("mymind.csv"));
    expect(items[0]?.card).toMatchObject({
      type: "link",
      url: "https://example.com/page",
      notes: "Remember this",
      tags: ["design", "inspiration"],
      createdAt: Date.parse("2024-01-05T12:00:00Z"),
    });
    expect(items[1]?.card).toMatchObject({
      type: "text",
      content: "# Grocery idea\n\nBuy figs\nand honey",
      tags: ["food"],
    });
    expect(items[2]?.error).toBe("mymind item has no link or text");
    expectValidCards(items);
  });

  test("a CSV without mymind's columns is not a mymind export", () => {
    expect(() => parseMymindCsv("url,title\nhttps://a.test,A")).toThrow(
      "mymind"
    );
  });
});

describe("Linkwarden", () => {
  test("collections become folders with their parents; looped parents stop", () => {
    const items = parseLinkwardenJson(fixture("linkwarden.json"));
    expect(items).toHaveLength(3);
    expect(items[0]?.card).toMatchObject({
      content: "Linkwarden docs",
      notes: "Self-hosted bookmarks",
      tags: ["tools"],
      folders: ["Work"],
      createdAt: Date.parse("2024-02-01T10:00:00.000Z"),
    });
    expect(items[1]?.card?.folders).toEqual(["Work / Design"]);
    expect(items[2]?.card?.folders).toEqual(["Loop B / Loop A"]);
    expectValidCards(items);
  });

  test("links the exporting user pinned become favorites", () => {
    const items = parseLinkwardenJson(fixture("linkwarden.json"));
    expect(items.map((item) => item.card?.isFavorited)).toEqual([
      true,
      true,
      undefined,
    ]);
  });

  test("JSON that isn't a Linkwarden backup", () => {
    expect(() => parseLinkwardenJson("{")).toThrow("Linkwarden");
    expect(() => parseLinkwardenJson('{"links":[]}')).toThrow("Linkwarden");
  });
});

describe("Omnivore", () => {
  test("a metadata file: labels as tags, Archived state, savedAt", () => {
    const items = parseOmnivoreJson(fixture("omnivore-metadata.json"));
    expect(items[0]?.card).toMatchObject({
      content: "Why tabs win",
      url: "https://example.com/tabs",
      tags: ["design", "Newsletter"],
      isArchived: true,
      createdAt: Date.parse("2024-05-01T09:00:00.000Z"),
    });
    expect(items[1]?.card?.isArchived).toBeUndefined();
    expectValidCards(items);
  });

  test("highlights become the note", () => {
    const item = omnivoreItem(
      { url: "https://example.com/h", savedAt: "2024-05-01T09:00:00Z" },
      "> A highlighted line\n\nMy comment"
    );
    expect(item.card?.notes).toBe("> A highlighted line\n\nMy comment");
  });

  test("JSON that isn't Omnivore metadata", () => {
    expect(() => parseOmnivoreJson('{"items":[]}')).toThrow("Omnivore");
    expect(() => parseOmnivoreJson('[{"href":"x"}]')).toThrow("Omnivore");
  });
});

describe("OneTab", () => {
  test("URL | Title lines, titles keep later pipes; other lines skipped", () => {
    const items = parseOneTabText(fixture("onetab.txt"));
    expect(items.map((item) => item.card?.content ?? item.error)).toEqual([
      "First tab | with a pipe",
      "Second tab",
      "https://example.com/three",
      "OneTab link is unsafe: only http and https links can be imported",
    ]);
  });

  test("text with no links is not a OneTab export", () => {
    expect(() => parseOneTabText("just some notes\n")).toThrow("OneTab");
  });
});

describe("parseImportSource", () => {
  test("routes every text source to its parser", () => {
    for (const mode of IMPORT_MODES) {
      if (mode !== "archive") {
        expect(() => parseImportSource(mode, "\u0000not an export")).toThrow();
      }
    }
    expect(
      parseImportSource("onetab", "https://a.test | A")[0]?.card?.url
    ).toBe("https://a.test");
  });

  test("fuzz: truncated files throw or give items, never crash differently", () => {
    const sources = {
      pocket: fixture("pocket.csv"),
      instapaper: fixture("instapaper.csv"),
      readwise: fixture("readwise.csv"),
      mymind: fixture("mymind.csv"),
      linkwarden: fixture("linkwarden.json"),
      omnivore: fixture("omnivore-metadata.json"),
      onetab: fixture("onetab.txt"),
    } as const;
    for (const [mode, text] of Object.entries(sources)) {
      for (let cut = 0; cut <= text.length; cut += 7) {
        try {
          const items = parseImportSource(
            mode as keyof typeof sources,
            text.slice(0, cut)
          );
          expectValidCards(items);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
      }
    }
  });
});

describe("importMaxBytes", () => {
  test("a ZIP gets the source's limit; files read whole stop at 20 MiB", () => {
    expect(importMaxBytes("omnivore", "Export.ZIP")).toBe(5 * 1024 ** 3);
    expect(importMaxBytes("omnivore", "metadata_0_to_20.json")).toBe(
      20 * 1024 ** 2
    );
    expect(importMaxBytes("pocket", "part_000000.csv")).toBe(20 * 1024 ** 2);
  });
});

describe("describeImportFailure", () => {
  test("names the source, with the right article", () => {
    expect(describeImportFailure("pocket", "invalid_source")).toContain(
      "doesn't look like a Pocket export"
    );
    expect(describeImportFailure("instapaper", "invalid_source")).toContain(
      "doesn't look like an Instapaper export"
    );
    expect(describeImportFailure("archive", "invalid_source")).toContain(
      "Teak archive"
    );
  });

  test("words codes and passes sentences through", () => {
    expect(describeImportFailure("onetab", "too_many_items")).toContain(
      "more than 10,000 items"
    );
    expect(describeImportFailure("onetab", "import_source_unavailable")).toBe(
      "Import failed. Please try again."
    );
    expect(
      describeImportFailure("archive", "Archive exceeds 10,000 cards")
    ).toBe("Archive exceeds 10,000 cards");
  });
});
