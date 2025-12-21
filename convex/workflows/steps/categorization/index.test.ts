// @ts-nocheck
import { mock, describe, expect, test, beforeEach, beforeAll, afterAll } from "bun:test";

const aiMocks = (global as any).__AI_MOCKS__ || {
  generateObject: mock(),
  experimental_transcribe: mock(),
};
(global as any).__AI_MOCKS__ = aiMocks;

mock.module("ai", () => aiMocks);

// Mock internal API
import { internal } from "../../../_generated/api";

// Setup fetch mock that can be restored
const originalFetch = global.fetch;
const mockFetch = mock();

import {
  classifyHandler,
  fetchStructuredDataHandler,
  mergeAndSaveHandler,
  classifyLinkCategory,
  enrichLinkCategory
} from "./index";

describe("categorization index", () => {
  const mockRunQuery = mock();
  const mockRunMutation = mock();
  const ctx = {
    runQuery: mockRunQuery,
    runMutation: mockRunMutation,
  } as any;

  beforeAll(() => {
    global.fetch = mockFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    mockRunQuery.mockReset();
    mockRunMutation.mockReset();
    mockFetch.mockReset();
  });

  describe("classifyLinkCategory", () => {
    test("classifies correctly", async () => {
      const card = {
        url: "https://github.com/microsoft/vscode",
        metadata: {
          linkPreview: { status: "success", title: "VS Code" }
        }
      };
      const result = await classifyLinkCategory(card);
      expect(result.category).toBe("software");
      expect(result.providerHint).toBe("github");
    });

    test("returns null for missing targetUrl", async () => {
      expect(await classifyLinkCategory({})).toBeNull();
    });

    test("uses linkPreview finalUrl if available", async () => {
      const card = {
        metadata: {
          linkPreview: { status: "success", finalUrl: "https://amazon.com/p" }
        }
      };
      const result = await classifyLinkCategory(card);
      expect(result.providerHint).toBe("amazon");
    });
  });

  describe("classifyHandler", () => {
    test("throws if card not found", async () => {
      mockRunQuery.mockResolvedValue(null);
      expect(classifyHandler(ctx, { cardId: "c1" })).rejects.toThrow("not found");
    });

    test("throws if card type is not link", async () => {
      mockRunQuery.mockResolvedValue({ _id: "c1", type: "text" });
      expect(classifyHandler(ctx, { cardId: "c1" })).rejects.toThrow("is not a link card");
    });

    test("skips if metadata is fresh", async () => {
      const fetchedAt = Date.now() - 1000;
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        type: "link",
        url: "https://example.com/a",
        metadata: {
          linkCategory: {
            category: "article",
            fetchedAt,
            sourceUrl: "https://example.com/a"
          }
        }
      });

      const result = await classifyHandler(ctx, { cardId: "c1" });
      expect(result.mode).toBe("skipped");
    });

    test("does not skip if sourceUrl changed", async () => {
      const fetchedAt = Date.now() - 1000;
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        type: "link",
        url: "https://example.com/b",
        metadata: {
          linkCategory: {
            category: "article",
            fetchedAt,
            sourceUrl: "https://example.com/a"
          }
        }
      });

      const result = await classifyHandler(ctx, { cardId: "c1" });
      expect(result.mode).toBe("classified");
    });

    test("throws if classification fails", async () => {
      mockRunQuery.mockResolvedValue({ _id: "c1", type: "link", url: "" });
      expect(classifyHandler(ctx, { cardId: "c1" })).rejects.toThrow("Failed to classify");
    });

    test("proceeds to classify", async () => {
      mockRunQuery.mockResolvedValue({ _id: "c1", type: "link", url: "https://example.com" });

      const result = await classifyHandler(ctx, { cardId: "c1" });
      expect(result.mode).toBe("classified");
      expect(result.classification).toBeDefined();
    });
  });

  describe("fetchStructuredDataHandler", () => {
    test("fetches and parses JSON-LD", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "text/html"]]),
        text: () => Promise.resolve(`
          <script type="application/ld+json">
            { "@type": "Book", "name": "The Hobbit" }
          </script>
        `)
      });

      const result = await fetchStructuredDataHandler(ctx, {
        cardId: "c1",
        sourceUrl: "https://amazon.com/hobbit",
        shouldFetch: true
      });
      expect(result.structuredData.entities[0].name).toBe("The Hobbit");
    });

    test("returns null if shouldFetch is false", async () => {
      const result = await fetchStructuredDataHandler(ctx, { shouldFetch: false });
      expect(result.structuredData).toBeNull();
    });

    test("returns null if fetch fails", async () => {
      mockFetch.mockResolvedValue({ ok: false });
      const result = await fetchStructuredDataHandler(ctx, { shouldFetch: true, sourceUrl: "https://example.com" });
      expect(result.structuredData).toBeNull();
    });

    test("returns null if content-type is not html", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "application/json"]]),
      });
      const result = await fetchStructuredDataHandler(ctx, { shouldFetch: true, sourceUrl: "https://example.com" });
      expect(result.structuredData).toBeNull();
    });

    test("handles fetch exception", async () => {
      mockFetch.mockRejectedValue(new Error("Network fail"));
      const result = await fetchStructuredDataHandler(ctx, { shouldFetch: true, sourceUrl: "https://example.com" });
      expect(result.structuredData).toBeNull();
    });

    test("handles large body and truncation", async () => {
      const largeText = "A".repeat(300000);
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "text/html"]]),
        text: () => Promise.resolve(largeText)
      });
      const result = await fetchStructuredDataHandler(ctx, { shouldFetch: true, sourceUrl: "https://example.com" });
      expect(result.structuredData).toBeDefined();
    });

    test("handles empty body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "text/html"]]),
        text: () => Promise.resolve("")
      });
      const result = await fetchStructuredDataHandler(ctx, { shouldFetch: true, sourceUrl: "https://example.com" });
      expect(result.structuredData).toBeNull();
    });

    test("stops after max items in JSON-LD", async () => {
      const entities = Array.from({ length: 10 }, (_, i) => ({ "@type": "Thing", name: `item${i}` }));
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "text/html"]]),
        text: () => Promise.resolve(`<script type="application/ld+json">${JSON.stringify(entities)}</script>`)
      });
      const result = await fetchStructuredDataHandler(ctx, { shouldFetch: true, sourceUrl: "https://example.com" });
      expect(result.structuredData.entities.length).toBe(8);
    });

    test("handles large content-length", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([
          ["content-type", "text/html"],
          ["content-length", "1000000"]
        ]),
      });
      const result = await fetchStructuredDataHandler(ctx, { shouldFetch: true, sourceUrl: "https://example.com" });
      expect(result.structuredData).toBeNull();
    });

    test("skips invalid JSON-LD blocks", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "text/html"]]),
        text: () => Promise.resolve(`
          <script type="application/ld+json">
            { invalid json }
          </script>
          <script type="application/ld+json">
            { "@type": "Book", "name": "Valid Book" }
          </script>
        `)
      });
      const result = await fetchStructuredDataHandler(ctx, { shouldFetch: true, sourceUrl: "https://example.com" });
      expect(result.structuredData).toBeDefined();
      expect(result.structuredData.entities.length).toBe(1);
      expect(result.structuredData.entities[0].name).toBe("Valid Book");
    });
  });

  describe("enrichLinkCategory", () => {
    test("enriches with provider data (Amazon)", async () => {
      const card = { url: "https://amazon.com/p" };
      const classification = { category: "product", providerHint: "amazon", confidence: 0.9 };
      const result = await enrichLinkCategory(card, classification, { structuredData: null });

      expect(result.detectedProvider).toBe("amazon");
    });

    test("covers stringArray and valueToText branches", async () => {
      // Test stringArray with string value
      const entity = {
        "@type": "Recipe",
        name: "R",
        recipeIngredient: "single ingredient"
      };
      const result = await enrichLinkCategory({ url: "https://x.com" }, { category: "recipe", confidence: 0.9 }, {
        structuredData: { entities: [entity] }
      });
      expect(result.facts.find(f => f.label === "Ingredients").value).toBe("single ingredient");

      // Test stringArray with object containing name
      const entity2 = {
        "@type": "Recipe",
        name: "R",
        recipeIngredient: { name: "obj ingredient" }
      };
      const result2 = await enrichLinkCategory({ url: "https://x.com" }, { category: "recipe", confidence: 0.9 }, {
        structuredData: { entities: [entity2] }
      });
      expect(result2.facts.find(f => f.label === "Ingredients").value).toBe("obj ingredient");
    });

    test("covers normalizeImage branches", async () => {
      const entity = { "@type": "Book", image: [{ url: "https://img1.com" }] };
      const result = await enrichLinkCategory({ url: "https://x.com" }, { category: "book", confidence: 0.9 }, {
        structuredData: { entities: [entity] }
      });
      expect(result.imageUrl).toBe("https://img1.com");
    });

    test("covers buildRawSelectorMap branches", async () => {
      const card = {
        url: "https://github.com/a/b",
        metadata: {
          linkPreview: {
            status: "success",
            raw: [
              { selector: "a[href$='/stargazers']", results: [{ text: "1.2k" }] },
              { selector: "" }
            ]
          }
        }
      };
      const result = await enrichLinkCategory(card, { category: "software", providerHint: "github", confidence: 0.9 });
      expect(result.facts.find(f => f.label === "Stars").value).toBe("1,200");
    });

    test("covers complex providerEnrichment image branch using Dribbble", async () => {
      const card = {
        url: "https://dribbble.com/shots/1",
        metadata: {
          linkPreview: {
            status: "success",
            raw: [
              {
                selector: "meta[property='og:image']",
                results: [{ attributes: [{ name: "content", value: "https://dribbble.img/1.jpg" }] }]
              },
              { selector: ".shot-stats [data-label='Likes']", results: [{ text: "100" }] },
              // Twitter stats to cover mapLabelToStat branches
              { selector: "meta[name='twitter:label1']", results: [{ attributes: [{ name: "content", value: "Views" }] }] },
              { selector: "meta[name='twitter:data1']", results: [{ attributes: [{ name: "content", value: "200" }] }] },
              { selector: "meta[name='twitter:label2']", results: [{ attributes: [{ name: "content", value: "Comments" }] }] },
              { selector: "meta[name='twitter:data2']", results: [{ attributes: [{ name: "content", value: "300" }] }] },
              // designer name from title
              { selector: "meta[property='og:title']", results: [{ attributes: [{ name: "content", value: "Shot by Designer Name on Dribbble" }] }] },
              // keywords
              { selector: "meta[name='keywords']", results: [{ attributes: [{ name: "content", value: "a,b,c,d,e,f" }] }] }
            ]
          }
        }
      };
      const result = await enrichLinkCategory(card, { category: "design_portfolio", confidence: 0.9 });
      expect(result.facts.find(f => f.label === "Views").value).toBe("200");
      expect(result.facts.find(f => f.label === "Comments").value).toBe("300");
      expect(result.facts.find(f => f.label === "Designer").value).toBe("Designer Name");
      expect(result.facts.find(f => f.label === "Tags").value).toBe("a, b, c");
    });

    test("covers Goodreads enrichment", async () => {
      const card = {
        url: "https://goodreads.com/b",
        metadata: {
          linkPreview: {
            status: "success",
            raw: [
              { selector: "meta[property='books:rating:average']", results: [{ attributes: [{ name: "content", value: "4.5" }] }] },
              { selector: "meta[property='books:rating:count']", results: [{ attributes: [{ name: "content", value: "1000" }] }] },
              { selector: "meta[property='books:isbn']", results: [{ attributes: [{ name: "content", value: "123" }] }] }
            ]
          }
        }
      };
      const result = await enrichLinkCategory(card, { category: "book", confidence: 0.9 });
      expect(result.facts.find(f => f.label === "Average rating").value).toBe("4.50 / 5");
      expect(result.facts.find(f => f.label === "Ratings").value).toBe("1,000");
    });

    test("covers IMDb enrichment", async () => {
      const card = {
        url: "https://imdb.com/m",
        metadata: {
          linkPreview: {
            status: "success",
            raw: [
              { selector: "meta[name='imdb:rating']", results: [{ attributes: [{ name: "content", value: "8.5" }] }] },
              { selector: "meta[name='imdb:votes']", results: [{ attributes: [{ name: "content", value: "5000" }] }] },
              { selector: "span[data-testid='title-techspec_runtime'] span", results: [{ text: "2h 30m" }] },
              { selector: "meta[property='video:release_date']", results: [{ attributes: [{ name: "content", value: "2020-01-01" }] }] }
            ]
          }
        }
      };
      const result = await enrichLinkCategory(card, { category: "movie", confidence: 0.9 });
      expect(result.facts.find(f => f.label === "IMDb rating").value).toBe("8.50 / 10");
      expect(result.facts.find(f => f.label === "Votes").value).toBe("5,000");
      expect(result.facts.find(f => f.label === "Runtime").value).toBe("2h 30m");
      expect(result.facts.find(f => f.label === "Released").value).toBe("Jan 1, 2020");
    });

    test("covers Amazon enrichment", async () => {
      const card = {
        url: "https://amazon.com/p",
        metadata: {
          linkPreview: {
            status: "success",
            raw: [
              { selector: ".a-price .a-offscreen", results: [{ text: "$19.99" }] },
              { selector: "meta[property='og:price:currency']", results: [{ attributes: [{ name: "content", value: "USD" }] }] }
            ]
          }
        }
      };
      const result = await enrichLinkCategory(card, { category: "product", confidence: 0.9 });
      expect(result.facts.find(f => f.label === "Price").value).toBe("$19.99 USD");
    });

    test("covers full GitHub enrichment", async () => {
      const card = {
        url: "https://github.com/a/b",
        metadata: {
          linkPreview: {
            status: "success",
            raw: [
              { selector: "a[href$='/stargazers']", results: [{ text: "100" }] },
              { selector: "a[href$='/network/members']", results: [{ text: "20" }] },
              { selector: "a[href$='/watchers']", results: [{ text: "5" }] },
              { selector: "span[itemprop='programmingLanguage']", results: [{ text: "TypeScript" }] },
              { selector: "relative-time", results: [{ text: "on Jan 1, 2023" }] }
            ]
          }
        }
      };
      const result = await enrichLinkCategory(card, { category: "software", confidence: 0.9 });
      expect(result.facts.find(f => f.label === "Stars").value).toBe("100");
      expect(result.facts.find(f => f.label === "Forks").value).toBe("20");
      expect(result.facts.find(f => f.label === "Watchers").value).toBe("5");
      expect(result.facts.find(f => f.label === "Language").value).toBe("TypeScript");
      expect(result.facts.find(f => f.label === "Updated").value).toBe("Jan 1, 2023");
    });

    test("covers null returns from providers when no data", async () => {
      const providers = ["github", "amazon", "imdb", "goodreads", "dribbble"];
      for (const p of providers) {
        const result = await enrichLinkCategory({ url: `https://${p}.com/test` }, { category: "article", confidence: 0.9 });
        expect(result.facts).toBeUndefined();
      }
    });

    test("covers various edge cases in helpers", async () => {
      // normalizeUrlForComparison catch
      mockRunQuery.mockResolvedValue({ _id: "c1", type: "link", url: "https://[invalid]" });
      const res1 = await classifyHandler(ctx, { cardId: "c1" });
      expect(res1.sourceUrl).toBe("https://[invalid]");

      // detectProvider catch
      const res2 = await enrichLinkCategory({ url: "https://[invalid]" }, { category: "article", confidence: 0.5 });
      expect(res2).toBeDefined();

      // stringArray with non-name object
      const res3 = await enrichLinkCategory({ url: "https://x.com" }, { category: "recipe", confidence: 0.9 }, {
        structuredData: { entities: [{ "@type": "Recipe", recipeIngredient: { noName: "x" } }] }
      });
      expect(res3.facts).toBeUndefined();

      // valueToText with number
      const res4 = await enrichLinkCategory({ url: "https://x.com" }, { category: "recipe", confidence: 0.9 }, {
        structuredData: { entities: [{ "@type": "Recipe", recipeYield: 5 }] }
      });
      expect(res4.facts?.find(f => f.label === "Servings").value).toBe("5");
    });

    test("covers design_portfolio category in enrichWithStructuredData", async () => {
      const entity = { "@type": "CreativeWork", name: "D", author: { name: "C" } };
      const result = await enrichLinkCategory({ url: "https://x.com" }, { category: "design_portfolio", confidence: 0.9 }, {
        structuredData: { entities: [entity] }
      });
      expect(result.facts?.find(f => f.label === "Creator").value).toBe("C");
    });

    test("handles various categories in enrichWithStructuredData", async () => {
      const cases = [
        {
          category: "book",
          entity: { "@type": "Book", name: "B", author: { name: "A" }, aggregateRating: { ratingValue: 5, ratingCount: 10 }, numberOfPages: 100, datePublished: "2020-01-01" },
          expectedFacts: ["Authors", "Rating", "Reviews", "Length", "Published"]
        },
        {
          category: "movie",
          entity: { "@type": "Movie", name: "M", aggregateRating: { ratingValue: 5, reviewCount: 10 }, datePublished: "2020-01-01" },
          expectedFacts: ["Rating", "Votes", "Release"]
        },
        {
          category: "tv",
          entity: { "@type": "TVSeries", name: "T", numberOfSeasons: 5, numberOfEpisodes: 50, datePublished: "2020-01-01" },
          expectedFacts: ["Seasons", "Episodes", "First aired"]
        },
        {
          category: "article",
          entity: { "@type": "NewsArticle", name: "A", datePublished: "2020-01-01", dateModified: "2020-01-02" },
          expectedFacts: ["Published", "Updated"]
        },
        {
          category: "podcast",
          entity: { "@type": "PodcastEpisode", name: "P", duration: "PT1H", partOfSeries: { name: "S" } },
          expectedFacts: ["Duration", "Series"]
        },
        {
          category: "music",
          entity: { "@type": "MusicRecording", name: "M", byArtist: { name: "A" }, duration: "PT3M" },
          expectedFacts: ["Artist", "Length"]
        },
        {
          category: "product",
          entity: { "@type": "Product", name: "P", offers: { price: 10, priceCurrency: "USD" }, brand: { name: "B" } },
          expectedFacts: ["Price", "Brand"]
        },
        {
          category: "course",
          entity: { "@type": "Course", name: "C", provider: { name: "P" } },
          expectedFacts: ["Provider"]
        },
        {
          category: "research",
          entity: { "@type": "ScholarlyArticle", name: "S", author: [{ name: "A1" }, { name: "A2" }], datePublished: "2020-01-01" },
          expectedFacts: ["Authors", "Published"]
        },
        {
          category: "event",
          entity: { "@type": "Event", name: "E", startDate: "2020-01-01", endDate: "2020-01-02", location: { name: "L" } },
          expectedFacts: ["Dates", "Location"]
        },
        {
          category: "software",
          entity: { "@type": "SoftwareApplication", name: "S", operatingSystem: "iOS", applicationCategory: "Game" },
          expectedFacts: ["Platform", "Category"]
        },
        {
          category: "design_portfolio",
          entity: { "@type": "CreativeWork", name: "D", author: { name: "C" } },
          expectedFacts: ["Creator"]
        }
      ];

      for (const c of cases) {
        const result = await enrichLinkCategory({ url: "https://x.com" }, { category: c.category, confidence: 0.9 }, {
          structuredData: { entities: [c.entity] }
        });
        for (const fact of c.expectedFacts) {
          expect(result.facts.some(f => f.label === fact)).toBe(true);
        }
      }
    });

    test("handles array and object types in stringArray and valueToText", async () => {
      const entity = {
        "@type": "Recipe",
        name: "R",
        recipeYield: 4,
        prepTime: "PT10M",
        recipeIngredient: ["a", { name: "b" }, 123]
      };
      const result = await enrichLinkCategory({ url: "https://x.com" }, { category: "recipe", confidence: 0.9 }, {
        structuredData: { entities: [entity] }
      });
      expect(result.facts.find(f => f.label === "Servings").value).toBe("4");
      expect(result.facts.find(f => f.label === "Ingredients").value).toContain("a, b");
    });

    test("handles various image formats in normalizeImage", async () => {
      const entity = { "@type": "Book", image: ["https://img1.com", { url: "https://img2.com" }] };
      const result = await enrichLinkCategory({ url: "https://x.com" }, { category: "book", confidence: 0.9 }, {
        structuredData: { entities: [entity] }
      });
      expect(result.imageUrl).toBe("https://img1.com");

      const imageObj = { "@type": "Book", image: { url: "https://img3.com" } };
      const result2 = await enrichLinkCategory({ url: "https://x.com" }, { category: "book", confidence: 0.9 }, {
        structuredData: { entities: [imageObj] }
      });
      expect(result2.imageUrl).toBe("https://img3.com");
    });

    test("handles provider detection edge cases", async () => {
      const urls = [
        "https://goodreads.com/b",
        "https://amazon.co.uk/p",
        "https://imdb.com/m",
        "https://netflix.com/t",
        "https://behance.net/p",
        "https://spotify.com/t",
        "https://apple.com/a",
        "https://youtube.com/v",
        "https://youtu.be/v",
        "https://medium.com/p",
        "https://substack.com/p"
      ];
      for (const url of urls) {
        const result = await enrichLinkCategory({ url }, { category: "article", confidence: 0.9 });
        expect(result.detectedProvider).toBeDefined();
      }
    });

    test("returns null from enrichWithStructuredData if no data found", async () => {
      const result = await enrichLinkCategory({ url: "https://x.com" }, { category: "book", confidence: 0.9 }, {
        structuredData: { entities: [{ "@type": "Other" }] }
      });
      expect(result.facts).toBeUndefined();
    });
  });

  describe("mergeAndSaveHandler", () => {
    test("saves enriched metadata", async () => {
      const card = { _id: "c1", type: "link" };
      const classification = { category: "software", confidence: 0.9 };
      const structuredData = { entities: [] };

      await mergeAndSaveHandler(ctx, {
        cardId: "c1",
        card,
        sourceUrl: "https://github.com/a/b",
        mode: "classified",
        classification,
        structuredData
      });

      expect(mockRunMutation).toHaveBeenCalled();
    });

    test("saves existing metadata on skip", async () => {
      const existingMetadata = { category: "article", confidence: 0.9, sourceUrl: "https://x.com" };
      await mergeAndSaveHandler(ctx, {
        cardId: "c1",
        mode: "skipped",
        existingMetadata
      });
      expect(mockRunMutation).toHaveBeenCalled();
    });

    test("throws on skip if existingMetadata missing", async () => {
      expect(mergeAndSaveHandler(ctx, { cardId: "c1", mode: "skipped" })).rejects.toThrow("required to skip");
    });

    test("throws if classification missing on classified mode", async () => {
      expect(mergeAndSaveHandler(ctx, { cardId: "c1", mode: "classified" })).rejects.toThrow("missing");
    });
  });
});

