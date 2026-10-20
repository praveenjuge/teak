import { describe, expect, test } from "bun:test";
import { formatLinkByline, formatPublishedDate } from "../linkByline";

const NOW = Date.UTC(2026, 9, 12, 12);

describe("formatLinkByline", () => {
  test("joins author, publisher and date", () => {
    expect(
      formatLinkByline(
        {
          author: "Jane Doe",
          hostname: "example.com",
          publishedAt: "2024-03-05",
          publisher: "The Daily Paper",
        },
        NOW
      )
    ).toBe("By Jane Doe · The Daily Paper · Mar 5, 2024");
  });

  test.each([
    ["The Verge", "theverge.com"],
    ["BBC", "www.bbc.co.uk"],
    ["github", "github.com"],
  ])("leaves out publisher %p that only repeats %p", (publisher, hostname) => {
    expect(formatLinkByline({ author: "Sam", hostname, publisher }, NOW)).toBe(
      "By Sam"
    );
  });

  test("leaves out a publisher that repeats the author", () => {
    expect(
      formatLinkByline(
        {
          author: "Paul Graham",
          hostname: "paulgraham.com",
          publisher: "paul graham",
        },
        NOW
      )
    ).toBe("By Paul Graham");
  });

  test("does not double a 'By' the page already wrote", () => {
    expect(formatLinkByline({ author: "  by   Ada Lovelace " }, NOW)).toBe(
      "By Ada Lovelace"
    );
  });

  test.each([
    ["a profile URL", "https://www.facebook.com/someone"],
    ["a bare www link", "www.example.com/authors/x"],
    ["whitespace", "   "],
  ])("ignores an author that is %s", (_label, author) => {
    expect(formatLinkByline({ author }, NOW)).toBeNull();
  });

  test("clips a very long author name", () => {
    const byline = formatLinkByline({ author: "A".repeat(300) }, NOW);
    expect(byline?.length).toBeLessThanOrEqual(84);
    expect(byline?.endsWith("…")).toBe(true);
  });

  test("keeps non-Latin names", () => {
    expect(
      formatLinkByline({ author: "山田太郎", publisher: "مجلة" }, NOW)
    ).toBe("By 山田太郎 · مجلة");
  });

  test("returns null when the page named nothing", () => {
    expect(formatLinkByline({ hostname: "example.com" }, NOW)).toBeNull();
  });
});

describe("formatPublishedDate", () => {
  test.each([
    ["2024-03-05", "Mar 5, 2024"],
    ["2024-03-05T23:30:00-05:00", "Mar 6, 2024"],
    ["Tue, 05 Mar 2024 10:00:00 GMT", "Mar 5, 2024"],
  ])("formats %p as %p", (value, expected) => {
    expect(formatPublishedDate(value, NOW)).toBe(expected);
  });

  test.each([
    ["garbage", "not a date"],
    ["empty", ""],
    ["epoch zero", "1970-01-01T00:00:00Z"],
    ["far future", "2031-01-01"],
    ["undefined", undefined],
  ])("ignores %s", (_label, value) => {
    expect(formatPublishedDate(value, NOW)).toBeNull();
  });
});
