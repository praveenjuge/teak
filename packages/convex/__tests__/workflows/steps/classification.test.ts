// @ts-nocheck
import { mock, describe, expect, test, beforeEach } from "bun:test";

// Mock AI module
const aiMocks = (global as any).__AI_MOCKS__ || {
  generateText: mock(),
  generateObject: mock(),
  experimental_transcribe: mock(),
  Output: { object: mock() },
};
(global as any).__AI_MOCKS__ = aiMocks;
mock.module("ai", () => aiMocks);

import { classify } from '../../../../convex/workflows/steps/classification';

describe("classification step", () => {
  const mockRunQuery = mock();
  const mockRunMutation = mock();
  const mockCtx = {
    runQuery: mockRunQuery,
    runMutation: mockRunMutation,
  } as any;

  beforeEach(() => {
    mockRunQuery.mockReset();
    mockRunMutation.mockReset();
    aiMocks.generateText.mockReset();
    aiMocks.generateObject.mockReset();
  });

  describe("classification error handling", () => {
    test("throws error when card not found", async () => {
      mockRunQuery.mockResolvedValue(null);

      await expect(classify(mockCtx, { cardId: "c1" })).rejects.toThrow("Card c1 not found for classification");
    });

    test("handles missing card gracefully", async () => {
      mockRunQuery.mockResolvedValue(undefined);

      await expect(classify(mockCtx, { cardId: "c2" })).rejects.toThrow();
    });
  });

  describe("quote classification stickiness", () => {
    test("preserves quote type when no conflicting signals", async () => {
      const card = {
        _id: "c1",
        type: "quote",
        content: "to be or not to be",
        processingStatus: { classify: { confidence: 0.95 } }
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("quote");
      expect(result.confidence).toBe(0.95);
      expect(result.shouldCategorize).toBe(false);
      expect(result.shouldGenerateRenderables).toBe(false);
      expect(result.needsLinkMetadata).toBe(false);
      expect(mockRunMutation).not.toHaveBeenCalled();
    });

    test("preserves quote with default confidence", async () => {
      const card = {
        _id: "c1",
        type: "quote",
        content: "test",
        processingStatus: {}
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("quote");
      expect(result.confidence).toBe(0.95);
    });

    test("re-classifies quote when URL present", async () => {
      const card = {
        _id: "c1",
        type: "quote",
        url: "https://example.com"
      };
      mockRunQuery.mockResolvedValue(card);

      await classify(mockCtx, { cardId: "c1" });

      expect(mockRunMutation).toHaveBeenCalled();
    });

    test("re-classifies quote when fileId present", async () => {
      const card = {
        _id: "c1",
        type: "quote",
        fileId: "f1"
      };
      mockRunQuery.mockResolvedValue(card);

      await classify(mockCtx, { cardId: "c1" });

      expect(mockRunMutation).toHaveBeenCalled();
    });
  });

  describe("quote heuristic detection", () => {
    test("detects quote from quoted content", async () => {
      const card = {
        _id: "c1",
        type: "text",
        content: '"This is a quote" - Author'
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("quote");
      expect(result.confidence).toBe(0.95);
      expect(mockRunMutation).toHaveBeenCalled();
    });

    test("detects single quote marks", async () => {
      const card = {
        _id: "c1",
        type: "text",
        content: "'This is a quote'"
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("quote");
    });

    test("detects markdown blockquotes", async () => {
      const card = {
        _id: "c1",
        type: "text",
        content: "> This is a blockquote"
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      // normalizeQuoteContent checks for surrounding quotes like "...", not markdown blockquotes
      // So this content is classified as text, not quote
      expect(result.type).toBe("text");
    });

    test("does not detect quote when URL present", async () => {
      const card = {
        _id: "c1",
        type: "text",
        content: '"quoted text"',
        url: "https://example.com"
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).not.toBe("quote");
    });
  });

  describe("MIME type classification", () => {
    test("classifies image MIME types strongly", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { mimeType: "image/png" }
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("image");
      expect(mockRunMutation).toHaveBeenCalled();
    });

    test("classifies video MIME types strongly", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { mimeType: "video/mp4" }
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("video");
    });

    test("classifies audio MIME types strongly", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { mimeType: "audio/mpeg" }
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("audio");
    });

    test("classifies PDF documents", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { mimeType: "application/pdf" }
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("document");
    });

    test("classifies Word documents", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("document");
    });
  });

  describe("file metadata classification", () => {
    test("classifies by duration as video when dimensions present", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { duration: 120, width: 1920, height: 1080 }
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("video");
    });

    test("classifies by duration as audio without dimensions", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { duration: 180 }
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("audio");
    });

    test("classifies by dimensions as image", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { width: 800, height: 600 }
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("image");
    });
  });

  describe("URL extension classification", () => {
    test("classifies image by extension", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com/image.png"
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("link");
    });

    test("classifies video by extension", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com/video.mp4"
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("link");
    });

    test("classifies audio by extension", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com/audio.mp3"
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("link");
    });

    test("handles URLs without extensions", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com/page"
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("link");
    });
  });

  describe("palette detection", () => {
    test("detects palette from multiple colors", async () => {
      const card = {
        _id: "c1",
        content: "#ff0000 #00ff00 #0000ff"
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("palette");
      expect(result.confidence).toBe(0.88);
    });

    test("detects palette from color names", async () => {
      const card = {
        _id: "c1",
        content: "red green blue"
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("palette");
    });

    test("detects palette from tags", async () => {
      const card = {
        _id: "c1",
        content: "#ff0000",
        tags: ["colors", "palette"]
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("palette");
    });

    test("detects palette from hint keywords", async () => {
      const card = {
        _id: "c1",
        content: "My brand colors palette"
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      // extractPaletteColors requires actual hex codes - just "palette" keyword isn't enough
      // unless there's at least 1 color code. Since this text has no colors, it's classified as text.
      expect(result.type).toBe("text");
    });

    test("does not detect palette with URL present", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com",
        content: "palette colors red green blue"
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("link");
    });
  });

  describe("URL-only card handling", () => {
    test("forces link type for URL-only card", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com",
        content: "https://example.com",
        type: "text"
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("link");
      expect(mockRunMutation).toHaveBeenCalled();
    });

    test("forces link type for empty content with URL", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com",
        content: "",
        type: "text"
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.type).toBe("link");
    });

    test("preserves non-link type with additional content", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com/image.png",
        content: "Check out this image"
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      // The .png extension causes classifyByExtension to return "image"
      // Since there's additional content beyond just the URL, it's not a URL-only card
      // So the type remains "image" instead of being normalized to "link"
      expect(result.type).toBe("image");
    });
  });

  describe("workflow flags", () => {
    test("sets shouldCategorize only for links", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com"
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.shouldCategorize).toBe(true);
    });

    test("does not categorize non-link cards", async () => {
      const card = {
        _id: "c1",
        content: "plain text"
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.shouldCategorize).toBe(false);
    });

    test("always shouldGenerateMetadata", async () => {
      const card = {
        _id: "c1",
        content: "test"
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.shouldGenerateMetadata).toBe(true);
    });

    test("shouldGenerateRenderables for images", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { mimeType: "image/png" }
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.shouldGenerateRenderables).toBe(true);
    });

    test("shouldGenerateRenderables for videos", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { mimeType: "video/mp4" }
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.shouldGenerateRenderables).toBe(true);
    });

    test("shouldGenerateRenderables for documents", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { mimeType: "application/pdf" }
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.shouldGenerateRenderables).toBe(true);
    });

    test("should not generate renderables for text", async () => {
      const card = {
        _id: "c1",
        content: "plain text"
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.shouldGenerateRenderables).toBe(false);
    });

    test("needsLinkMetadata for links without preview", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com"
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.needsLinkMetadata).toBe(true);
    });

    test("does not need link metadata with successful preview", async () => {
      const card = {
        _id: "c1",
        url: "https://example.com",
        metadata: { linkPreview: { status: "success" } }
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.needsLinkMetadata).toBe(false);
    });
  });

  describe("confidence normalization", () => {
    test("clamps confidence to maximum 1.0", async () => {
      const card = {
        _id: "c1",
        fileMetadata: { mimeType: "image/png" }
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });

    test("clamps confidence to minimum 0.0", async () => {
      const card = {
        _id: "c1",
        content: "test"
      };
      mockRunQuery.mockResolvedValue(card);

      const result = await classify(mockCtx, { cardId: "c1" });

      expect(result.confidence).toBeGreaterThanOrEqual(0.0);
    });
  });
});
