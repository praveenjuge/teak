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
  });

  describe("classifyHandler", () => {
    test("throws if card type is not link", async () => {
      mockRunQuery.mockResolvedValue({ _id: "c1", type: "text" });
      expect(classifyHandler(ctx, { cardId: "c1" })).rejects.toThrow("is not a link card");
    });

    test("skips if metadata is fresh", async () => {
      const fetchedAt = Date.now() - 1000;
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        type: "link",
        url: "https://example.com",
        metadata: {
          linkCategory: {
            category: "article",
            fetchedAt,
            sourceUrl: "https://example.com"
          }
        }
      });

      const result = await classifyHandler(ctx, { cardId: "c1" });
      expect(result.mode).toBe("skipped");
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
  });

  describe("enrichLinkCategory", () => {
    test("enriches with provider data (Amazon)", async () => {
      const card = { url: "https://amazon.com/p" };
      const classification = { category: "product", providerHint: "amazon", confidence: 0.9 };
      const result = await enrichLinkCategory(card, classification, { structuredData: null });

      expect(result.detectedProvider).toBe("amazon");
    });

    test("enriches with structured data (Movie)", async () => {
      const card = { url: "https://imdb.com/m" };
      const classification = { category: "movie", confidence: 0.9 };
      const structuredData = {
        entities: [{ "@type": "Movie", "name": "Inception", "aggregateRating": { "ratingValue": 8.8 } }]
      };
      const result = await enrichLinkCategory(card, classification, { structuredData });
      expect(result.facts).toContainEqual({ label: "Rating", value: "8.8" });
    });

    test("enriches with structured data (Recipe)", async () => {
      const card = { url: "https://tasty.com/r" };
      const classification = { category: "recipe", confidence: 0.9 };
      const structuredData = {
        entities: [{ "@type": "Recipe", "name": "Pasta", "prepTime": "PT10M", "recipeIngredient": ["flour", "water"] }]
      };
      const result = await enrichLinkCategory(card, classification, { structuredData });
      expect(result.facts).toContainEqual({ label: "Timing", value: "Prep 10m" });
      expect(result.facts).toContainEqual({ label: "Ingredients", value: "flour, water" });
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
  });
});
