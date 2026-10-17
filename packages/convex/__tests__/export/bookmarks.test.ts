import { describe, expect, test } from "bun:test";
import { buildBookmarksHtml, escapeHtml } from "../../export/bookmarks";
import { type SerializedCard, toDualTimestamp } from "../../export/serialize";
import { parseBookmarksHtml } from "../../import/bookmarks";

const link = (overrides: Partial<SerializedCard> = {}): SerializedCard => ({
  id: "card_1",
  type: "link",
  content: "https://example.com",
  url: "https://example.com",
  tags: [],
  aiTags: [],
  folders: [],
  isFavorited: false,
  isArchived: false,
  isHidden: false,
  createdAt: toDualTimestamp(1_700_000_000_000),
  updatedAt: toDualTimestamp(1_700_000_500_000),
  ...overrides,
});

const seeded = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
};

const PIECES = [
  "<",
  ">",
  "&",
  '"',
  "'",
  "&amp;",
  "</A>",
  "</DL>",
  "<script>",
  "<H3>",
  "a",
  "😀",
  "مرحبا",
  "日本語",
  " ",
];

describe("buildBookmarksHtml", () => {
  test("writes the Netscape header and an empty list for no links", () => {
    const html = buildBookmarksHtml([]);
    expect(html.startsWith("<!DOCTYPE NETSCAPE-Bookmark-file-1>")).toBe(true);
    expect(html).toContain('CONTENT="text/html; charset=UTF-8"');
    expect(html).toContain("<DL><p>\n</DL><p>");
    expect(parseBookmarksHtml(html)).toEqual([]);
  });

  test("writes only link cards with a safe web URL", () => {
    const html = buildBookmarksHtml([
      link({ id: "a", url: "https://a.example", metadataTitle: "A" }),
      link({ id: "b", type: "text", url: "https://b.example" }),
      link({ id: "c", url: "javascript:alert(1)", metadataTitle: "C" }),
      link({ id: "d", url: undefined, metadataTitle: "D" }),
    ]);
    const parsed = parseBookmarksHtml(html);
    expect(parsed.map((item) => item.card?.url)).toEqual(["https://a.example"]);
    expect(html).not.toContain("javascript:");
  });

  test("dates, tags, and the title falls back to content, then the URL", () => {
    const html = buildBookmarksHtml([
      link({ metadataTitle: "Titled", tags: ["design", "ui"] }),
      link({ url: "https://b.example/", content: "Typed text" }),
      link({ url: "https://c.example/", content: "" }),
    ]);
    expect(html).toContain(
      'ADD_DATE="1700000000" LAST_MODIFIED="1700000500" TAGS="design,ui">Titled</A>'
    );
    expect(parseBookmarksHtml(html).map((item) => item.card?.content)).toEqual([
      "Titled",
      "Typed text",
      "https://c.example/",
    ]);
  });

  test("unfiled links first, then a section per folder, a link in each of its folders", () => {
    const html = buildBookmarksHtml([
      link({ url: "https://two.example/", folders: ["Work", "Reading"] }),
      link({ url: "https://loose.example/" }),
      link({ url: "https://one.example/", folders: ["Reading"] }),
    ]);
    const parsed = parseBookmarksHtml(html).map((item) => [
      item.card?.url,
      item.card?.folders ?? [],
    ]);
    expect(parsed).toEqual([
      ["https://loose.example/", []],
      ["https://two.example/", ["Reading"]],
      ["https://one.example/", ["Reading"]],
      ["https://two.example/", ["Work"]],
    ]);
  });

  test("one card in 50 folders appears in all 50", () => {
    const folders = Array.from({ length: 50 }, (_, index) => `F${index}`);
    const html = buildBookmarksHtml([link({ folders })]);
    expect(html.match(/<H3>/g)).toHaveLength(50);
    expect(parseBookmarksHtml(html)).toHaveLength(50);
  });

  test("escapes titles, folder names, and URLs", () => {
    const html = buildBookmarksHtml([
      link({
        url: 'https://x.example/?q="a"&b=<c>',
        metadataTitle: '<script>alert("x")</script> & co',
        folders: ['</DL><script>alert(1)</script>"'],
        tags: ['"><img src=x>'],
      }),
    ]);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    const [item] = parseBookmarksHtml(html);
    expect(item?.card?.content).toBe('<script>alert("x")</script> & co');
    expect(item?.card?.url).toBe('https://x.example/?q="a"&b=<c>');
    expect(item?.card?.folders).toEqual(['</DL><script>alert(1)</script>"']);
    expect(item?.card?.tags).toEqual(['"><img src=x>']);
  });

  test("titles and folder names stay on one line", () => {
    const html = buildBookmarksHtml([
      link({ metadataTitle: "Line one\nline two", folders: ["A\r\nB"] }),
    ]);
    const [item] = parseBookmarksHtml(html);
    expect(item?.card?.content).toBe("Line one line two");
    expect(item?.card?.folders).toEqual(["A B"]);
  });

  test("keeps 300-character titles and folder names whole", () => {
    const long = "標".repeat(300);
    const [item] = parseBookmarksHtml(
      buildBookmarksHtml([link({ metadataTitle: long, folders: [long] })])
    );
    expect(item?.card?.content).toBe(long);
    expect(item?.card?.folders).toEqual([long]);
  });

  test("fuzz: escaped text parses back unchanged", () => {
    const random = seeded(7);
    for (let round = 0; round < 200; round++) {
      let text = "";
      const length = 1 + Math.floor(random() * 10);
      for (let index = 0; index < length; index++) {
        text += PIECES[Math.floor(random() * PIECES.length)];
      }
      const title = text.replace(/\s+/g, " ").trim() || "x";
      const html = buildBookmarksHtml([
        link({ metadataTitle: title, folders: [title] }),
      ]);
      const parsed = parseBookmarksHtml(html);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]?.card?.content).toBe(title);
      expect(parsed[0]?.card?.folders).toEqual([title]);
      expect(escapeHtml(title)).not.toMatch(/[<>"']/);
    }
  });
});
