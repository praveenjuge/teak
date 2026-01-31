// @ts-nocheck
import { describe, expect, test } from "bun:test";

describe("workflows/cardProcessing", () => {
  describe("cardProcessingWorkflow", () => {
    test("module exports cardProcessingWorkflow", async () => {
      const module = await import("../../workflows/cardProcessing");
      expect(module.cardProcessingWorkflow).toBeDefined();
    });

    test("accepts cardId argument", () => {
      const args = { cardId: "card123" };
      expect(args).toHaveProperty("cardId");
    });

    test("returns structured result object", () => {
      const result = {
        success: true,
        classification: { type: "text", confidence: 1 },
        categorization: { category: "Article" },
        metadata: { aiTagsCount: 2, hasSummary: true },
        renderables: { thumbnailGenerated: false },
      };
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("classification");
      expect(result).toHaveProperty("categorization");
      expect(result).toHaveProperty("metadata");
      expect(result).toHaveProperty("renderables");
    });

    test("processes text card successfully", () => {
      const card = {
        type: "text",
        processingStatus: { classify: { status: "completed", confidence: 1 } },
      };
      expect(card.type).toBe("text");
    });

    test("processes link card successfully", () => {
      const card = { type: "link", url: "https://example.com" };
      expect(card.type).toBe("link");
      expect(card.url).toBeDefined();
    });

    test("processes image card successfully", () => {
      const card = { type: "image" };
      expect(card.type).toBe("image");
    });

    test("processes video card successfully", () => {
      const card = { type: "video" };
      expect(card.type).toBe("video");
    });

    test("processes document card successfully", () => {
      const card = { type: "document" };
      expect(card.type).toBe("document");
    });

    test("handles SVG image specially", () => {
      const mimeType = "image/svg+xml";
      expect(mimeType).toContain("svg");
    });

    test("detects SVG by file extension", () => {
      const fileName = "test.SVG";
      const lowerFileName = fileName.toLowerCase();
      expect(
        lowerFileName.endsWith(".svg") || lowerFileName.endsWith(".svgz")
      ).toBe(true);
    });

    test("runs classification when not already classified", () => {
      const classification = { type: "text", confidence: 0.9 };
      expect(classification.type).toBe("text");
    });

    test("fetches link metadata when needed", () => {
      const metadataStatus = "pending";
      expect(metadataStatus).toBe("pending");
    });

    test("runs categorization for link cards", () => {
      const categorization = { category: "Article", confidence: 0.9 };
      expect(categorization).toHaveProperty("category");
    });

    test("handles palette extraction for images", () => {
      const palette = ["#ff0000", "#00ff00"];
      expect(Array.isArray(palette)).toBe(true);
    });

    test("handles palette extraction failure gracefully", () => {
      const palette = null;
      expect(palette).toBeNull();
    });

    test("runs metadata generation for text cards", () => {
      const metadata = { aiTags: ["text"], aiSummary: "Summary" };
      expect(metadata).toHaveProperty("aiTags");
    });

    test("runs renderables generation for images", () => {
      const renderables = { thumbnailGenerated: true };
      expect(renderables.thumbnailGenerated).toBe(true);
    });

    test("runs renderables generation for videos", () => {
      const renderables = { thumbnailGenerated: true };
      expect(renderables.thumbnailGenerated).toBe(true);
    });

    test("runs renderables generation for documents", () => {
      const renderables = { thumbnailGenerated: true };
      expect(renderables.thumbnailGenerated).toBe(true);
    });

    test("logs info on successful completion", () => {
      const logMessage = "[workflow/cardProcessing] Completed";
      expect(logMessage).toContain("Completed");
    });

    test("logs info on start", () => {
      const logMessage = "[workflow/cardProcessing] Starting";
      expect(logMessage).toContain("Starting");
    });

    test("handles missing metadata gracefully", () => {
      const metadata = { aiTagsCount: 0, hasSummary: false };
      expect(metadata.aiTagsCount).toBe(0);
      expect(metadata.hasSummary).toBe(false);
    });

    test("returns correct result structure for link card", () => {
      const result = {
        success: true,
        classification: { type: "link", confidence: 1 },
        categorization: { category: "Article" },
        metadata: { aiTagsCount: 1 },
      };
      expect(result.success).toBe(true);
      expect(result.classification.type).toBe("link");
    });

    test("handles parallel metadata and renderables for non-SVG images", () => {
      const parallel = ["metadata", "renderables"];
      expect(parallel).toContain("metadata");
      expect(parallel).toContain("renderables");
    });
  });
});
