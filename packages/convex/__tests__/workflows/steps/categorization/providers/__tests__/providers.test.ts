// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { enrichAmazon } from "../../../../../../../convex/workflows/steps/categorization/providers/amazon";
import {
  formatCountString,
  formatDate,
  formatRating,
  getRawAttribute,
  getRawText,
  normalizeWhitespace,
} from "../../../../../../../convex/workflows/steps/categorization/providers/common";
import { enrichDribbble } from "../../../../../../../convex/workflows/steps/categorization/providers/dribbble";
import { enrichGithub } from "../../../../../../../convex/workflows/steps/categorization/providers/github";
import { enrichGoodreads } from "../../../../../../../convex/workflows/steps/categorization/providers/goodreads";
import { enrichImdb } from "../../../../../../../convex/workflows/steps/categorization/providers/imdb";

describe("categorization providers common", () => {
  it("normalizeWhitespace", () => {
    expect(normalizeWhitespace("  hello  world  ")).toBe("hello world");
    expect(normalizeWhitespace("")).toBeUndefined();
    expect(normalizeWhitespace(undefined)).toBeUndefined();
  });

  it("getRawText", () => {
    const map = new Map([["#id", { text: "  Some Text  " }]]);
    expect(getRawText(map, "#id")).toBe("Some Text");
    expect(getRawText(map, "#missing")).toBeUndefined();
  });

  it("getRawAttribute", () => {
    const map = new Map([
      ["meta", { attributes: [{ name: "content", value: "  value  " }] }],
    ]);
    expect(getRawAttribute(map, "meta", "content")).toBe("value");
    expect(getRawAttribute(map, "meta", "missing")).toBeUndefined();
    expect(getRawAttribute(map, "missing", "content")).toBeUndefined();

    // Test multiple attributes and case sensitivity
    const map2 = new Map([
      [
        "meta",
        {
          attributes: [
            { name: "Content", value: "upper" },
            { name: "other", value: "other" },
          ],
        },
      ],
    ]);
    expect(getRawAttribute(map2, "meta", "content")).toBe("upper");

    // Test entry without attributes
    const map3 = new Map([["meta", { text: "just text" }]]);
    expect(getRawAttribute(map3, "meta", "content")).toBeUndefined();
  });

  it("formatCountString", () => {
    expect(formatCountString("1,234")).toBe("1,234");
    expect(formatCountString("1.2k")).toBe("1,200");
    expect(formatCountString("1.5m")).toBe("1,500,000");
    expect(formatCountString("not a number")).toBe("not a number");
  });

  it("formatRating", () => {
    expect(formatRating("4.567")).toBe("4.57");
    expect(formatRating("5")).toBe("5.00");
    expect(formatRating("not numeric")).toBe("not numeric");
    expect(formatRating(undefined)).toBeUndefined();
  });

  it("formatDate", () => {
    expect(formatDate("2023-12-21")).toBe("Dec 21, 2023");
    expect(formatDate("invalid date")).toBeUndefined();
    expect(formatDate(undefined)).toBeUndefined();
  });
});

describe("enrichAmazon", () => {
  it("extracts price and currency", () => {
    const map = new Map([
      [".a-price .a-offscreen", { text: "$10.00" }],
      [
        "meta[property='og:price:currency']",
        { attributes: [{ name: "content", value: "USD" }] },
      ],
    ]);
    const result = enrichAmazon(map);
    expect(result.facts).toContainEqual({
      label: "Price",
      value: "$10.00 USD",
    });
    expect(result.raw.price).toBe("$10.00");
    expect(result.raw.currency).toBe("USD");
  });

  it("handles price only", () => {
    const map = new Map([[".a-price .a-offscreen", { text: "$10.00" }]]);
    const result = enrichAmazon(map);
    expect(result.facts).toContainEqual({ label: "Price", value: "$10.00" });
  });

  it("returns null if no price or currency", () => {
    const map = new Map();
    expect(enrichAmazon(map)).toBeNull();
  });
});

describe("enrichGithub", () => {
  it("extracts stats and language", () => {
    const map = new Map([
      ["a[href$='/stargazers']", { text: "1.2k" }],
      ["span[itemprop='programmingLanguage']", { text: "TypeScript" }],
      ["relative-time", { text: "on Oct 10, 2023" }],
    ]);
    const result = enrichGithub(map);
    // Note: formatCountString("1.2k") should be "1,200"
    expect(result.facts).toContainEqual({ label: "Stars", value: "1,200" });
    expect(result.facts).toContainEqual({
      label: "Language",
      value: "TypeScript",
    });
    expect(result.facts).toContainEqual({
      label: "Updated",
      value: "Oct 10, 2023",
    });
  });

  it("returns null if no facts", () => {
    expect(enrichGithub(new Map())).toBeNull();
  });
});

describe("enrichGoodreads", () => {
  it("extracts rating and count", () => {
    const map = new Map([
      [
        "meta[property='books:rating:average']",
        { attributes: [{ name: "content", value: "4.2" }] },
      ],
      [
        "meta[property='books:rating:count']",
        { attributes: [{ name: "content", value: "100" }] },
      ],
    ]);
    const result = enrichGoodreads(map);
    expect(result.facts).toContainEqual({
      label: "Average rating",
      value: "4.20 / 5",
    });
    expect(result.facts).toContainEqual({ label: "Ratings", value: "100" });
  });

  it("returns null if no facts", () => {
    expect(enrichGoodreads(new Map())).toBeNull();
  });
});

describe("enrichImdb", () => {
  it("extracts rating and votes", () => {
    const map = new Map([
      [
        "meta[name='imdb:rating']",
        { attributes: [{ name: "content", value: "8.5" }] },
      ],
      [
        "meta[name='imdb:votes']",
        { attributes: [{ name: "content", value: "100k" }] },
      ],
    ]);
    const result = enrichImdb(map);
    expect(result.facts).toContainEqual({
      label: "IMDb rating",
      value: "8.50 / 10",
    });
    expect(result.facts).toContainEqual({ label: "Votes", value: "100,000" });
  });

  it("extracts runtime and released", () => {
    const map = new Map([
      ["span[data-testid='title-techspec_runtime'] span", { text: "2h 30m" }],
      [
        "meta[property='video:release_date']",
        { attributes: [{ name: "content", value: "2023-12-21" }] },
      ],
    ]);
    const result = enrichImdb(map);
    expect(result.facts).toContainEqual({ label: "Runtime", value: "2h 30m" });
    expect(result.facts).toContainEqual({
      label: "Released",
      value: "Dec 21, 2023",
    });
  });

  it("returns null if no facts", () => {
    expect(enrichImdb(new Map())).toBeNull();
  });
});

describe("enrichDribbble", () => {
  it("extracts stats and tags", () => {
    const map = new Map([
      ["[data-testid='shot-likes-count']", { text: "50" }],
      [
        "meta[name='keywords']",
        { attributes: [{ name: "content", value: "design, ui, ux" }] },
      ],
      [
        "meta[name='author']",
        { attributes: [{ name: "content", value: "Designer Name" }] },
      ],
    ]);
    const result = enrichDribbble(map);
    expect(result.facts).toContainEqual({ label: "Likes", value: "50" });
    expect(result.facts).toContainEqual({
      label: "Designer",
      value: "Designer Name",
    });
    expect(result.facts).toContainEqual({
      label: "Tags",
      value: "design, ui, ux",
    });
    expect(result.raw.keywords).toContain("ui");
  });

  it("extracts stats from twitter meta", () => {
    const map = new Map([
      [
        "meta[name='twitter:label1']",
        { attributes: [{ name: "content", value: "Likes" }] },
      ],
      [
        "meta[name='twitter:data1']",
        { attributes: [{ name: "content", value: "100" }] },
      ],
      [
        "meta[name='twitter:label2']",
        { attributes: [{ name: "content", value: "Views" }] },
      ],
      [
        "meta[name='twitter:data2']",
        { attributes: [{ name: "content", value: "1k" }] },
      ],
    ]);
    const result = enrichDribbble(map);
    expect(result.facts).toContainEqual({ label: "Likes", value: "100" });
    expect(result.facts).toContainEqual({ label: "Views", value: "1,000" });
  });

  it("extracts designer from og:title", () => {
    const map = new Map([
      [
        "meta[property='og:title']",
        {
          attributes: [
            { name: "content", value: "Shot Title by John Doe on Dribbble" },
          ],
        },
      ],
    ]);
    const result = enrichDribbble(map);
    expect(result.facts).toContainEqual({
      label: "Designer",
      value: "John Doe",
    });
  });

  it("returns null if no enrichment", () => {
    expect(enrichDribbble(new Map())).toBeNull();
  });
});
