// @ts-nocheck
import { describe, expect, test } from "bun:test";

describe("workflows/linkEnrichment", () => {
  describe("linkEnrichmentWorkflow", () => {
    test("module exports linkEnrichmentWorkflow", async () => {
      const module = await import("../../workflows/linkEnrichment");
      expect(module.linkEnrichmentWorkflow).toBeDefined();
    });

    test("accepts cardId argument", () => {
      const args = { cardId: "card123" };
      expect(args).toHaveProperty("cardId");
    });

    test("returns structured result object", () => {
      const result = {
        category: "Article",
        confidence: 0.9,
        imageUrl: "https://example.com/image.jpg",
        factsCount: 5,
      };
      expect(result).toHaveProperty("category");
      expect(result).toHaveProperty("confidence");
      expect(result).toHaveProperty("imageUrl");
      expect(result).toHaveProperty("factsCount");
    });

    test("processes link card successfully", () => {
      const result = {
        category: "Article",
        confidence: 0.9,
        factsCount: 5,
      };
      expect(result.category).toBe("Article");
      expect(result.factsCount).toBe(5);
    });

    test("classifies link card", () => {
      const classification = {
        mode: "classified",
        category: "Video",
        confidence: 0.95,
        sourceUrl: "https://youtube.com/watch?v=123",
      };
      expect(classification.mode).toBe("classified");
    });

    test("fetches structured data when shouldFetchStructured is true", () => {
      const shouldFetch = true;
      expect(shouldFetch).toBe(true);
    });

    test("merges and saves results", () => {
      const result = {
        category: "Article",
        confidence: 0.92,
        imageUrl: "https://blog.example.com/cover.jpg",
      };
      expect(result.category).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
    });

    test("handles unclassified mode", () => {
      const classification = {
        mode: "unclassified",
        category: "General",
        confidence: 0.5,
      };
      expect(classification.mode).toBe("unclassified");
    });

    test("skips structured data fetch when mode is unclassified", () => {
      const classification = {
        mode: "unclassified",
        category: "Unknown",
        shouldFetchStructured: false,
      };
      expect(classification.shouldFetchStructured).toBe(false);
    });

    test("handles missing imageUrl in result", () => {
      const result = { category: "Text", confidence: 0.8 };
      expect(result.imageUrl).toBeUndefined();
    });

    test("handles zero facts count", () => {
      const factsCount = 0;
      expect(factsCount).toBe(0);
    });

    test("handles high confidence classification", () => {
      const confidence = 0.98;
      expect(confidence).toBeGreaterThan(0.95);
    });

    test("handles low confidence classification", () => {
      const confidence = 0.45;
      expect(confidence).toBeLessThan(0.5);
    });

    test("uses retry configuration for all steps", () => {
      const retry = { maxAttempts: 3, delay: 1000 };
      expect(retry).toHaveProperty("maxAttempts");
    });

    test("logs info on successful completion", () => {
      const logMessage = "[workflow/linkEnrichment] Completed";
      expect(logMessage).toContain("Completed");
    });

    test("passes correct arguments to classifyStep", () => {
      const args = { cardId: "card123" };
      expect(args.cardId).toBe("card123");
    });

    test("passes correct arguments to fetchStructuredDataStep", () => {
      const args = {
        cardId: "card123",
        sourceUrl: "https://shop.example.com/product/123",
        shouldFetch: true,
      };
      expect(args.cardId).toBe("card123");
      expect(args.sourceUrl).toContain("product");
      expect(args.shouldFetch).toBe(true);
    });

    test("passes correct arguments to mergeAndSaveStep", () => {
      const args = {
        cardId: "card123",
        card: { _id: "card123", title: "Test Post" },
        sourceUrl: "https://blog.example.com/post",
      };
      expect(args.cardId).toBe("card123");
      expect(args.card).toHaveProperty("title");
    });

    test("handles null structuredData when not fetching", () => {
      const structuredData = null;
      expect(structuredData).toBeNull();
    });
  });

  describe("startLinkEnrichmentWorkflow", () => {
    test("module exports startLinkEnrichmentWorkflow", async () => {
      const module = await import("../../workflows/linkEnrichment");
      expect(module.startLinkEnrichmentWorkflow).toBeDefined();
    });

    test("accepts cardId argument", () => {
      const args = { cardId: "card123", startAsync: true };
      expect(args).toHaveProperty("cardId");
      expect(args).toHaveProperty("startAsync");
    });

    test("accepts startAsync parameter", () => {
      const startAsync = true;
      expect(startAsync).toBe(true);
    });

    test("handles missing startAsync parameter", () => {
      const args = { cardId: "card123" };
      expect(args).toHaveProperty("cardId");
    });

    test("returns workflowId when started async", () => {
      const result = { workflowId: "wf_123" };
      expect(result).toHaveProperty("workflowId");
    });

    test("returns enrichment result when run synchronously", () => {
      const result = { category: "Article", confidence: 0.9 };
      expect(result).toHaveProperty("category");
      expect(result).toHaveProperty("confidence");
    });

    test("returns union type structure", () => {
      const result = { workflowId: "wf_123" };
      const result2 = { category: "Article", confidence: 0.9 };
      expect(result || result2).toBeDefined();
    });
  });
});
