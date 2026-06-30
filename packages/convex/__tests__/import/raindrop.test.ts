import { describe, expect, test } from "bun:test";
import { parseRaindropCsv } from "../../import/raindrop";

describe("backend raindrop CSV parser", () => {
  test("maps url, title, note, tags, folder, created, and favorite", () => {
    const createdAt = Date.parse("2023-05-15T10:30:00.000Z");
    const csv = [
      "id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite",
      `1,Example Site,A great resource,An excerpt,https://example.com,Design/Tools,"design, tools",2023-05-15T10:30:00.000Z,https://img.example/cover.png,,true`,
    ].join("\n");
    const parsed = parseRaindropCsv(csv);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].card).toMatchObject({
      type: "link",
      content: "Example Site",
      url: "https://example.com",
      notes: "A great resource",
      tags: ["Design", "Tools", "design", "tools"],
      isFavorited: true,
      createdAt,
    });
  });

  test("preserves commas inside quoted note and tags fields", () => {
    const csv = [
      "url,title,note,folder,tags,created,favorite",
      `https://safe.test,"Title, with comma","Note, with comma",Inbox,"a, b, c",1700000000,false`,
    ].join("\n");
    const parsed = parseRaindropCsv(csv);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].card).toMatchObject({
      content: "Title, with comma",
      notes: "Note, with comma",
      tags: ["Inbox", "a", "b", "c"],
      url: "https://safe.test",
      createdAt: 1_700_000_000_000,
    });
    expect(parsed[0].card?.isFavorited).toBeUndefined();
  });

  test("parses created as unix seconds and ISO timestamps", () => {
    const iso = Date.parse("2022-01-02T03:04:05.000Z");
    const csv = [
      "url,created",
      "https://unix.test,1700000000",
      "https://iso.test,2022-01-02T03:04:05.000Z",
    ].join("\n");
    const parsed = parseRaindropCsv(csv);
    expect(parsed[0].card?.createdAt).toBe(1_700_000_000_000);
    expect(parsed[1].card?.createdAt).toBe(iso);
  });

  test("falls back to url when the title is blank", () => {
    const csv = ["url,title", "https://no-title.test,"].join("\n");
    const parsed = parseRaindropCsv(csv);
    expect(parsed[0].card?.content).toBe("https://no-title.test");
  });

  test("rejects unsafe URLs without dropping the next valid row", () => {
    const csv = [
      "url,title",
      "javascript:alert(1),Bad",
      "https://safe.test,Safe",
    ].join("\n");
    const parsed = parseRaindropCsv(csv);
    expect(parsed[0].error).toContain("unsafe");
    expect(parsed[0].card).toBeUndefined();
    expect(parsed[1].card?.url).toBe("https://safe.test");
  });

  test("skips blank rows and matches headers case-insensitively", () => {
    const csv = ["URL,Title", "https://example.test,Example", "", "   "].join(
      "\n"
    );
    const parsed = parseRaindropCsv(csv);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].card?.url).toBe("https://example.test");
  });

  test("throws when the url column is missing", () => {
    expect(() => parseRaindropCsv("title,note\nHello,World")).toThrow(
      "missing a url column"
    );
  });
});
