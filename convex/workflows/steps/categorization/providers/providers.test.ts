import { describe, it, expect } from "bun:test";
import { enrichAmazon } from "./amazon";
import { enrichGithub } from "./github";
import { enrichGoodreads } from "./goodreads";
import { enrichImdb } from "./imdb";
import type { RawSelectorMap } from "./common";

// Helper function to create a raw selector map
const createMap = (entries: Array<[string, { text?: string; attributes?: Array<{ name?: string; value?: string }> }]>): RawSelectorMap => {
  return new Map(entries);
};

describe("enrichAmazon", () => {
  it("should return null when no data found", () => {
    const map = createMap([]);
    expect(enrichAmazon(map)).toBeNull();
  });

  it("should extract price from #priceblock_ourprice", () => {
    const map = createMap([
      ["#priceblock_ourprice", { text: "$19.99" }],
    ]);
    const result = enrichAmazon(map);

    expect(result).not.toBeNull();
    expect(result?.facts).toHaveLength(1);
    expect(result?.facts?.[0]).toEqual({ label: "Price", value: "$19.99" });
    expect(result?.raw?.price).toBe("$19.99");
  });

  it("should extract price from #priceblock_dealprice", () => {
    const map = createMap([
      ["#priceblock_dealprice", { text: "$14.99" }],
    ]);
    const result = enrichAmazon(map);

    expect(result?.facts?.[0]?.value).toBe("$14.99");
  });

  it("should extract price from .a-price .a-offscreen", () => {
    const map = createMap([
      [".a-price .a-offscreen", { text: "$29.99" }],
    ]);
    const result = enrichAmazon(map);

    expect(result?.facts?.[0]?.value).toBe("$29.99");
  });

  it("should extract price from meta[name='price']", () => {
    const map = createMap([
      ["meta[name='price']", { attributes: [{ name: "content", value: "$39.99" }] }],
    ]);
    const result = enrichAmazon(map);

    expect(result?.facts?.[0]?.value).toBe("$39.99");
  });

  it("should extract price from meta[property='og:price:amount']", () => {
    const map = createMap([
      ["meta[property='og:price:amount']", { attributes: [{ name: "content", value: "49.99" }] }],
    ]);
    const result = enrichAmazon(map);

    expect(result?.facts?.[0]?.value).toBe("49.99");
  });

  it("should combine price and currency", () => {
    const map = createMap([
      ["#priceblock_ourprice", { text: "19.99" }],
      ["meta[property='og:price:currency']", { attributes: [{ name: "content", value: "USD" }] }],
    ]);
    const result = enrichAmazon(map);

    expect(result?.facts?.[0]?.value).toBe("19.99 USD");
  });

  it("should handle price with currency", () => {
    const map = createMap([
      ["#priceblock_ourprice", { text: "$19.99" }],
      ["meta[property='og:price:currency']", { attributes: [{ name: "content", value: "USD" }] }],
    ]);
    const result = enrichAmazon(map);

    expect(result?.facts?.[0]?.value).toBe("$19.99 USD");
  });

  it("should handle currency only", () => {
    const map = createMap([
      ["meta[property='og:price:currency']", { attributes: [{ name: "content", value: "EUR" }] }],
    ]);
    const result = enrichAmazon(map);

    expect(result?.facts?.[0]?.value).toBe("EUR");
  });

  it("should trim whitespace from price", () => {
    const map = createMap([
      ["#priceblock_ourprice", { text: "  $19.99  " }],
    ]);
    const result = enrichAmazon(map);

    expect(result?.facts?.[0]?.value).toBe("$19.99");
  });

  it("should prioritize price sources in order", () => {
    const map = createMap([
      ["#priceblock_ourprice", { text: "$10.00" }],
      ["#priceblock_dealprice", { text: "$5.00" }],
      [".a-price .a-offscreen", { text: "$15.00" }],
    ]);
    const result = enrichAmazon(map);

    // Should prioritize #priceblock_ourprice first
    expect(result?.facts?.[0]?.value).toBe("$10.00");
  });

  it("should include raw data in result", () => {
    const map = createMap([
      ["#priceblock_ourprice", { text: "$19.99" }],
      ["meta[property='og:price:currency']", { attributes: [{ name: "content", value: "USD" }] }],
    ]);
    const result = enrichAmazon(map);

    expect(result?.raw).toEqual({
      price: "$19.99",
      currency: "USD",
    });
  });
});

describe("enrichGithub", () => {
  it("should return null when no data found", () => {
    const map = createMap([]);
    expect(enrichGithub(map)).toBeNull();
  });

  it("should extract stars count", () => {
    const map = createMap([
      ["a[href$='/stargazers']", { text: "1,234" }],
    ]);
    const result = enrichGithub(map);

    expect(result?.facts).toHaveLength(1);
    expect(result?.facts?.[0]).toEqual({ label: "Stars", value: "1,234" });
    expect(result?.raw?.stars).toBe("1,234");
  });

  it("should extract forks count", () => {
    const map = createMap([
      ["a[href$='/network/members']", { text: "567" }],
    ]);
    const result = enrichGithub(map);

    expect(result?.facts?.[0]).toEqual({ label: "Forks", value: "567" });
  });

  it("should extract watchers count", () => {
    const map = createMap([
      ["a[href$='/watchers']", { text: "89" }],
    ]);
    const result = enrichGithub(map);

    expect(result?.facts?.[0]).toEqual({ label: "Watchers", value: "89" });
  });

  it("should extract programming language", () => {
    const map = createMap([
      ["span[itemprop='programmingLanguage']", { text: "TypeScript" }],
    ]);
    const result = enrichGithub(map);

    expect(result?.facts?.[0]).toEqual({ label: "Language", value: "TypeScript" });
  });

  it("should extract and clean updated time", () => {
    const map = createMap([
      ["relative-time", { text: "on 3 days ago" }],
    ]);
    const result = enrichGithub(map);

    expect(result?.facts?.[0]).toEqual({ label: "Updated", value: "3 days ago" });
  });

  it("should handle updated time without 'on' prefix", () => {
    const map = createMap([
      ["relative-time", { text: "2 days ago" }],
    ]);
    const result = enrichGithub(map);

    expect(result?.facts?.[0]).toEqual({ label: "Updated", value: "2 days ago" });
  });

  it("should extract all available data", () => {
    const map = createMap([
      ["a[href$='/stargazers']", { text: "5.2k" }],
      ["a[href$='/network/members']", { text: "1.1k" }],
      ["a[href$='/watchers']", { text: "234" }],
      ["span[itemprop='programmingLanguage']", { text: "JavaScript" }],
      ["relative-time", { text: "on yesterday" }],
    ]);
    const result = enrichGithub(map);

    expect(result?.facts).toHaveLength(5);
    expect(result?.raw).toEqual({
      stars: "5,200",
      forks: "1,100",
      watchers: "234",
      language: "JavaScript",
      updated: "on yesterday",
    });
  });

  it("should format k suffix counts", () => {
    const map = createMap([
      ["a[href$='/stargazers']", { text: "1.5k" }],
    ]);
    const result = enrichGithub(map);

    expect(result?.facts?.[0]?.value).toBe("1,500");
  });

  it("should trim whitespace", () => {
    const map = createMap([
      ["span[itemprop='programmingLanguage']", { text: "  Python  " }],
    ]);
    const result = enrichGithub(map);

    expect(result?.facts?.[0]?.value).toBe("Python");
  });
});

describe("enrichGoodreads", () => {
  it("should return null when no data found", () => {
    const map = createMap([]);
    expect(enrichGoodreads(map)).toBeNull();
  });

  it("should extract average rating", () => {
    const map = createMap([
      ["meta[property='books:rating:average']", { attributes: [{ name: "content", value: "4.5" }] }],
    ]);
    const result = enrichGoodreads(map);

    expect(result?.facts).toHaveLength(1);
    expect(result?.facts?.[0]).toEqual({ label: "Average rating", value: "4.50 / 5" });
    expect(result?.raw?.ratingAverage).toBe("4.50");
  });

  it("should extract rating count", () => {
    const map = createMap([
      ["meta[property='books:rating:count']", { attributes: [{ name: "content", value: "10,500" }] }],
    ]);
    const result = enrichGoodreads(map);

    expect(result?.facts?.[0]).toEqual({ label: "Ratings", value: "10,500" });
  });

  it("should extract ISBN", () => {
    const map = createMap([
      ["meta[property='books:isbn']", { attributes: [{ name: "content", value: "978-3-16-148410-0" }] }],
    ]);
    const result = enrichGoodreads(map);

    expect(result?.facts?.[0]).toEqual({ label: "ISBN", value: "978-3-16-148410-0" });
  });

  it("should extract all available data", () => {
    const map = createMap([
      ["meta[property='books:rating:average']", { attributes: [{ name: "content", value: "4.23" }] }],
      ["meta[property='books:rating:count']", { attributes: [{ name: "content", value: "125k" }] }],
      ["meta[property='books:isbn']", { attributes: [{ name: "content", value: "1234567890" }] }],
    ]);
    const result = enrichGoodreads(map);

    expect(result?.facts).toHaveLength(3);
    expect(result?.raw).toEqual({
      ratingAverage: "4.23",
      ratingCount: "125,000",
      isbn: "1234567890",
    });
  });

  it("should format rating with 2 decimal places", () => {
    const map = createMap([
      ["meta[property='books:rating:average']", { attributes: [{ name: "content", value: "4" }] }],
    ]);
    const result = enrichGoodreads(map);

    expect(result?.facts?.[0]?.value).toBe("4.00 / 5");
  });

  it("should format k suffix counts", () => {
    const map = createMap([
      ["meta[property='books:rating:count']", { attributes: [{ name: "content", value: "2.5k" }] }],
    ]);
    const result = enrichGoodreads(map);

    expect(result?.facts?.[0]?.value).toBe("2,500");
  });

  it("should handle only rating and count", () => {
    const map = createMap([
      ["meta[property='books:rating:average']", { attributes: [{ name: "content", value: "3.8" }] }],
      ["meta[property='books:rating:count']", { attributes: [{ name: "content", value: "500" }] }],
    ]);
    const result = enrichGoodreads(map);

    expect(result?.facts).toHaveLength(2);
    expect(result?.raw?.isbn).toBeNull();
  });
});

describe("enrichImdb", () => {
  it("should return null when no data found", () => {
    const map = createMap([]);
    expect(enrichImdb(map)).toBeNull();
  });

  it("should extract rating from meta tag", () => {
    const map = createMap([
      ["meta[name='imdb:rating']", { attributes: [{ name: "content", value: "8.5" }] }],
    ]);
    const result = enrichImdb(map);

    expect(result?.facts).toHaveLength(1);
    expect(result?.facts?.[0]).toEqual({ label: "IMDb rating", value: "8.50 / 10" });
    expect(result?.raw?.rating).toBe("8.50");
  });

  it("should extract rating from text content", () => {
    const map = createMap([
      ["span[data-testid='hero-rating-bar__aggregate-rating__score']", { text: "9.2" }],
    ]);
    const result = enrichImdb(map);

    expect(result?.facts?.[0]?.value).toBe("9.20 / 10");
  });

  it("should extract votes count", () => {
    const map = createMap([
      ["meta[name='imdb:votes']", { attributes: [{ name: "content", value: "1.5M" }] }],
    ]);
    const result = enrichImdb(map);

    expect(result?.facts?.[0]).toEqual({ label: "Votes", value: "1,500,000" });
  });

  it("should extract runtime", () => {
    const map = createMap([
      ["span[data-testid='title-techspec_runtime'] span", { text: "2h 30m" }],
    ]);
    const result = enrichImdb(map);

    expect(result?.facts?.[0]).toEqual({ label: "Runtime", value: "2h 30m" });
  });

  it("should extract and format release date", () => {
    const map = createMap([
      ["meta[property='video:release_date']", { attributes: [{ name: "content", value: "2023-12-25" }] }],
    ]);
    const result = enrichImdb(map);

    expect(result?.facts?.[0]?.label).toBe("Released");
    expect(result?.facts?.[0]?.value).toBeDefined();
    expect(result?.facts?.[0]?.value).toContain("Dec");
  });

  it("should return undefined for invalid date", () => {
    const map = createMap([
      ["meta[property='video:release_date']", { attributes: [{ name: "content", value: "invalid-date" }] }],
    ]);
    const result = enrichImdb(map);

    // Should not include released fact for invalid date
    const releasedFact = result?.facts?.find((f) => f.label === "Released");
    expect(releasedFact).toBeUndefined();
  });

  it("should extract all available data", () => {
    const map = createMap([
      ["meta[name='imdb:rating']", { attributes: [{ name: "content", value: "8.7" }] }],
      ["meta[name='imdb:votes']", { attributes: [{ name: "content", value: "500K" }] }],
      ["span[data-testid='title-techspec_runtime'] span", { text: "2h 15m" }],
      ["meta[property='video:release_date']", { attributes: [{ name: "content", value: "2023-01-15" }] }],
    ]);
    const result = enrichImdb(map);

    expect(result?.facts).toHaveLength(4);
    expect(result?.raw).toEqual({
      rating: "8.70",
      votes: "500,000",
      runtime: "2h 15m",
      releaseDate: "2023-01-15",
    });
  });

  it("should prioritize meta rating over text content", () => {
    const map = createMap([
      ["meta[name='imdb:rating']", { attributes: [{ name: "content", value: "8.0" }] }],
      ["span[data-testid='hero-rating-bar__aggregate-rating__score']", { text: "9.0" }],
    ]);
    const result = enrichImdb(map);

    expect(result?.facts?.[0]?.value).toBe("8.00 / 10");
  });

  it("should use text content when meta rating is missing", () => {
    const map = createMap([
      ["span[data-testid='hero-rating-bar__aggregate-rating__score']", { text: "7.8" }],
    ]);
    const result = enrichImdb(map);

    expect(result?.facts?.[0]?.value).toBe("7.80 / 10");
  });

  it("should format various vote formats", () => {
    const map = createMap([
      ["meta[name='imdb:votes']", { attributes: [{ name: "content", value: "1,234" }] }],
    ]);
    const result = enrichImdb(map);

    expect(result?.facts?.[0]?.value).toBe("1,234");
  });
});
