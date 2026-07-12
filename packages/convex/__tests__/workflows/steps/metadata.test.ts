// @ts-nocheck
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { r2MockModuleFactory, r2Mocks } from "../../helpers/r2Mock.test-utils";

const aiMocks = (global as any).__AI_MOCKS__ ?? {};
aiMocks.generateText ??= mock();
aiMocks.generateObject ??= mock();
aiMocks.experimental_transcribe ??= mock();
aiMocks.Output ??= { object: mock() };
(global as any).__AI_MOCKS__ = aiMocks;

mock.module("ai", () => aiMocks);

mock.module("../../../../convex/storage/r2", r2MockModuleFactory);

// Mock internal API
import { internal } from "../../../../convex/_generated/api";

const originalFetch = global.fetch;
const mockFetch = mock();
global.fetch = mockFetch as any;

import {
  buildLinkContentParts,
  generateHandler,
  resolveImageAnalysisKey,
} from "../../../../convex/workflows/steps/metadata";

afterAll(() => {
  global.fetch = originalFetch;
});

describe("metadata builds link content parts", () => {
  test("handles full metadata", () => {
    const card = {
      metadata: {
        linkPreview: {
          status: "success",
          title: "T",
          description: "D",
          author: "A",
          publisher: "P",
          publishedAt: "Date",
        },
      },
    };
    const parts = buildLinkContentParts(card);
    expect(parts).toContain("Title: T");
    expect(parts).toContain("Description: D");
    expect(parts).toContain("Author: A");
    expect(parts).toContain("Publisher: P");
    expect(parts).toContain("Published: Date");
  });

  test("falls back to URL if no metadata", () => {
    const card = { url: "https://example.com" };
    const parts = buildLinkContentParts(card);
    expect(parts).toEqual(["URL: https://example.com"]);
  });

  test("handles metadata with missing title", () => {
    const card = {
      url: "https://example.com",
      metadata: {
        linkPreview: {
          status: "success",
          description: "Description only",
        },
      },
    };
    const parts = buildLinkContentParts(card);
    expect(parts).toContain("Description: Description only");
  });

  test("handles empty link preview", () => {
    const card = {
      url: "https://example.com",
      metadata: {
        linkPreview: {
          status: "success",
        },
      },
    };
    const parts = buildLinkContentParts(card);
    expect(parts).toContain("URL: https://example.com");
  });

  test("uses content when URL is missing", () => {
    const card = { content: "https://fallback.com" };
    const parts = buildLinkContentParts(card);
    expect(parts).toContain("URL: https://fallback.com");
  });
});

describe("resolveImageAnalysisKey", () => {
  test("always prefers the bounded thumbnail", () => {
    expect(
      resolveImageAnalysisKey({
        fileKey: "original",
        thumbnailKey: "thumbnail",
      })
    ).toBe("thumbnail");
  });

  test("uses an original only when stored dimensions prove it is bounded", () => {
    expect(
      resolveImageAnalysisKey({
        fileKey: "small",
        fileMetadata: { height: 400, width: 400 },
      })
    ).toBe("small");
    expect(
      resolveImageAnalysisKey({
        fileKey: "large",
        fileMetadata: { height: 6000, width: 6000 },
      })
    ).toBeUndefined();
    expect(
      resolveImageAnalysisKey({
        fileKey: "tiny",
        fileMetadata: { height: 1, width: 1 },
      })
    ).toBeUndefined();
  });
});

describe("metadata handler", () => {
  const mockRunQuery = mock();
  const mockRunMutation = mock();
  const mockScheduler = { runAfter: mock() };
  const ctx = {
    runQuery: mockRunQuery,
    runMutation: mockRunMutation,
    scheduler: mockScheduler,
  } as any;

  beforeEach(() => {
    mockRunQuery.mockReset();
    mockRunMutation.mockReset();
    r2Mocks.resolveObjectUrl.mockReset();
    mockScheduler.runAfter.mockReset();
    aiMocks.generateText.mockReset();
    aiMocks.generateObject.mockReset();
    aiMocks.experimental_transcribe.mockReset();
    aiMocks.Output.object.mockReset();
    mockFetch.mockReset();

    // Set up default mock returns
    mockRunMutation.mockResolvedValue(true);
    aiMocks.Output.object.mockReturnValue({ schema: {} });
    aiMocks.generateText.mockResolvedValue({
      output: { tags: ["tag1"], summary: "summary" },
    });
  });

  describe("error handling", () => {
    test("skips if card was deleted before metadata generation", async () => {
      mockRunQuery.mockResolvedValue(null);
      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "text",
      });
      expect(result.mode).toBe("skipped");
    });

    test("completes without retry when there is no AI input", async () => {
      mockRunQuery.mockResolvedValue({ _id: "c1", content: "" });
      aiMocks.generateText.mockResolvedValue({
        output: { tags: [], summary: "" },
      });
      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "text",
      });
      expect(result.mode).toBe("skipped");
    });

    test("uses the URL while optional link enrichment is pending", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        url: "https://example.com",
        metadataStatus: "pending",
        metadata: {},
      });
      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "link",
      });
      expect(result.mode).toBe("completed");
      expect(result.aiTags).toEqual(["tag1"]);
    });
  });

  describe("text card metadata", () => {
    test("generates metadata for text card", async () => {
      mockRunQuery.mockResolvedValue({ _id: "c1", content: "hello world" });
      aiMocks.generateText.mockResolvedValue({
        output: { tags: ["greeting"], summary: "A greeting" },
      });

      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "text",
      });

      expect(result.aiTags).toEqual(["greeting"]);
      expect(result.aiSummary).toBe("A greeting");
      expect(result.confidence).toBe(0.95);
      expect(mockRunMutation).toHaveBeenCalled();
    });

    test("handles empty text content", async () => {
      mockRunQuery.mockResolvedValue({ _id: "c1", content: "" });
      aiMocks.generateText.mockResolvedValue({
        output: { tags: [], summary: "" },
      });

      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "text",
      });
      expect(result.mode).toBe("skipped");
    });
  });

  describe("image card metadata", () => {
    test("generates metadata for raster image", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "f1",
        thumbnailKey: "t1",
        fileMetadata: { mimeType: "image/png" },
      });
      r2Mocks.resolveObjectUrl.mockResolvedValue("https://image.png");
      aiMocks.generateText.mockResolvedValue({
        output: { tags: ["photo"], summary: "A photo" },
      });

      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "image",
      });

      expect(result.aiTags).toEqual(["photo"]);
      expect(result.confidence).toBe(0.9);
      expect(r2Mocks.resolveObjectUrl).toHaveBeenCalledWith("t1");
    });

    test("uses thumbnail for SVG files", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "f1",
        thumbnailKey: "t1",
        fileMetadata: { mimeType: "image/svg+xml" },
      });
      r2Mocks.resolveObjectUrl.mockResolvedValue("https://thumbnail.png");
      aiMocks.generateText.mockResolvedValue({
        output: { tags: ["svg"], summary: "SVG image" },
      });

      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "image",
      });

      expect(result.aiTags).toEqual(["svg"]);
      expect(r2Mocks.resolveObjectUrl).toHaveBeenCalledWith("t1");
    });

    test("detects SVG by file extension", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "f1",
        thumbnailKey: "t1",
        fileMetadata: { fileName: "diagram.svg" },
      });
      r2Mocks.resolveObjectUrl.mockResolvedValue("https://thumbnail.png");
      aiMocks.generateText.mockResolvedValue({
        output: { tags: ["diagram"], summary: "A diagram" },
      });

      const _result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "image",
      });

      expect(r2Mocks.resolveObjectUrl).toHaveBeenCalledWith("t1");
    });

    test("handles uppercase SVG extension", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "f1",
        thumbnailKey: "t1",
        fileMetadata: { fileName: "diagram.SVG" },
      });
      r2Mocks.resolveObjectUrl.mockResolvedValue("https://thumbnail.png");

      await generateHandler(ctx, { cardId: "c1", cardType: "image" });

      expect(r2Mocks.resolveObjectUrl).toHaveBeenCalledWith("t1");
    });

    test("handles missing image file", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "f1",
      });
      r2Mocks.resolveObjectUrl.mockResolvedValue(null);

      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "image",
      });
      expect(result.mode).toBe("skipped");
    });
  });

  describe("video card metadata", () => {
    test("generates metadata from video thumbnail", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        thumbnailKey: "t1",
      });
      r2Mocks.resolveObjectUrl.mockResolvedValue("https://video-thumb.jpg");
      aiMocks.generateText.mockResolvedValue({
        output: { tags: ["video"], summary: "Video content" },
      });

      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "video",
      });

      expect(result.aiTags).toEqual(["video"]);
      expect(result.confidence).toBe(0.88);
      expect(r2Mocks.resolveObjectUrl).toHaveBeenCalledWith("t1");
    });

    test("includes filename in video analysis", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        thumbnailKey: "t1",
        fileMetadata: { fileName: "movie.mp4" },
      });
      r2Mocks.resolveObjectUrl.mockResolvedValue("https://thumb.jpg");
      aiMocks.generateText.mockResolvedValue({
        output: { tags: ["movie"], summary: "A movie" },
      });

      await generateHandler(ctx, { cardId: "c1", cardType: "video" });

      expect(aiMocks.generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.arrayContaining([
                expect.objectContaining({
                  type: "text",
                  text: expect.stringContaining("movie.mp4"),
                }),
              ]),
            }),
          ]),
        })
      );
    });
  });

  describe("audio card metadata", () => {
    test("generates metadata from audio transcript", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "a1",
        fileMetadata: { mimeType: "audio/mp3" },
      });
      r2Mocks.resolveObjectUrl.mockResolvedValue("https://audio.mp3");
      mockFetch.mockResolvedValue({
        ok: true,
        headers: { get: () => "audio/mp3" },
        arrayBuffer: async () => new ArrayBuffer(8),
      });
      aiMocks.experimental_transcribe.mockResolvedValue({
        text: "spoken text in audio",
      });
      aiMocks.generateText.mockResolvedValue({
        output: { tags: ["speech"], summary: "Audio content" },
      });

      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "audio",
      });

      expect(result.aiTranscript).toBe("spoken text in audio");
      expect(result.aiTags).toEqual(["speech"]);
      expect(result.confidence).toBe(0.85);
    });

    test("handles missing audio file", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        fileKey: "a1",
        fileMetadata: { mimeType: "audio/wav" },
      });
      r2Mocks.resolveObjectUrl.mockResolvedValue(null);

      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "audio",
      });
      expect(result.mode).toBe("skipped");
    });
  });

  describe("link card metadata", () => {
    test("generates metadata for link with preview", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        url: "https://example.com",
        metadata: {
          linkPreview: {
            status: "success",
            title: "Example Site",
            description: "An example website",
          },
        },
      });
      aiMocks.generateText.mockResolvedValue({
        output: { tags: ["website"], summary: "Web content" },
      });

      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "link",
      });

      expect(result.aiTags).toEqual(["website"]);
      expect(result.confidence).toBe(0.9);
    });

    test("schedules screenshot for link cards", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        url: "https://example.com",
        metadata: { linkPreview: { status: "success", title: "Site" } },
      });
      aiMocks.generateText.mockResolvedValue({
        output: { tags: ["link"], summary: "link sum" },
      });

      await generateHandler(ctx, { cardId: "c1", cardType: "link" });

      expect(mockScheduler.runAfter).toHaveBeenCalledWith(
        0,
        internal.workflows.screenshot.startScreenshotWorkflow,
        { cardId: "c1" }
      );
    });

    test("handles link with incomplete metadata", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        url: "https://example.com",
        metadata: { linkPreview: { status: "success" } },
      });
      aiMocks.generateText.mockResolvedValue({
        output: { tags: ["link"], summary: "Link summary" },
      });

      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "link",
      });

      expect(result.aiSummary).toBe("Link summary");
    });
  });

  describe("document card metadata", () => {
    test("generates metadata for document with filename", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        content: "Document content here",
        fileMetadata: { fileName: "report.pdf" },
      });
      aiMocks.generateText.mockResolvedValue({
        output: { tags: ["report"], summary: "A report" },
      });

      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "document",
      });

      expect(result.aiTags).toEqual(["report"]);
      expect(result.confidence).toBe(0.85);
    });

    test("handles document without filename", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        content: "Just content",
      });
      aiMocks.generateText.mockResolvedValue({
        output: { tags: ["doc"], summary: "Document summary" },
      });

      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "document",
      });

      expect(result.aiTags).toEqual(["doc"]);
    });
  });

  describe("quote card metadata", () => {
    test("generates metadata for quote", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        content: "To be or not to be",
      });
      aiMocks.generateText.mockResolvedValue({
        output: { tags: ["shakespeare"], summary: "Famous quote" },
      });

      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "quote",
      });

      expect(result.aiTags).toEqual(["shakespeare"]);
      expect(result.confidence).toBe(0.95);
    });

    test("handles quote with whitespace", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        content: "  quoted text  ",
      });
      aiMocks.generateText.mockResolvedValue({
        output: { tags: ["quote"], summary: "Quote summary" },
      });

      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "quote",
      });

      expect(result.aiTags).toEqual(["quote"]);
    });
  });

  describe("palette card metadata", () => {
    test("generates metadata for palette with colors", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        content: "My palette",
        colors: [
          { hex: "#ff0000", name: "Red" },
          { hex: "#00ff00", name: "Green" },
        ],
      });
      aiMocks.generateText.mockResolvedValue({
        output: { tags: ["colors"], summary: "Color palette" },
      });

      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "palette",
      });

      expect(result.aiTags).toEqual(["colors"]);
      expect(result.confidence).toBe(0.9);
    });

    test("handles palette with unnamed colors", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        colors: [{ hex: "#ff0000" }, { hex: "#0000ff" }],
      });
      aiMocks.generateText.mockResolvedValue({
        output: { tags: ["palette"], summary: "Palette" },
      });

      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "palette",
      });

      expect(result.aiTags).toEqual(["palette"]);
    });

    test("handles palette without colors", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        content: "Palette description",
      });
      aiMocks.generateText.mockResolvedValue({
        output: { tags: ["palette"], summary: "Summary" },
      });

      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "palette",
      });

      expect(result.aiTags).toEqual(["palette"]);
    });
  });

  describe("processing status updates", () => {
    test("updates processing status with metadata stage", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        content: "test",
        processingStatus: { classify: { status: "completed" } },
      });
      aiMocks.generateText.mockResolvedValue({
        output: { tags: ["test"], summary: "Test summary" },
      });

      await generateHandler(ctx, { cardId: "c1", cardType: "text" });

      expect(mockRunMutation).toHaveBeenCalledWith(
        internal.workflows.aiMetadata.mutations.updateCardAI,
        expect.objectContaining({
          cardId: "c1",
          processingStatus: expect.objectContaining({
            metadata: expect.objectContaining({
              status: "completed",
            }),
          }),
        })
      );
    });

    test("preserves existing processing status", async () => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        content: "test",
        processingStatus: {
          classify: { status: "completed", confidence: 0.9 },
          renderables: { status: "pending" },
        },
      });
      aiMocks.generateText.mockResolvedValue({
        output: { tags: ["test"], summary: "Summary" },
      });

      await generateHandler(ctx, { cardId: "c1", cardType: "text" });

      expect(mockRunMutation).toHaveBeenCalledWith(
        internal.workflows.aiMetadata.mutations.updateCardAI,
        expect.objectContaining({
          processingStatus: expect.objectContaining({
            classify: { status: "completed", confidence: 0.9 },
            renderables: { status: "pending" },
          }),
        })
      );
    });
  });

  describe("edge cases", () => {
    test("handles undefined aiSummary", async () => {
      mockRunQuery.mockResolvedValue({ _id: "c1", content: "test" });
      aiMocks.generateText.mockResolvedValue({
        output: { tags: ["tag1"], summary: "" },
      });

      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "text",
      });

      expect(result.aiTags).toEqual(["tag1"]);
      expect(mockRunMutation).toHaveBeenCalledWith(
        internal.workflows.aiMetadata.mutations.updateCardAI,
        expect.objectContaining({
          aiSummary: undefined,
        })
      );
    });

    test("handles undefined aiTags", async () => {
      mockRunQuery.mockResolvedValue({ _id: "c1", content: "test" });
      aiMocks.generateText.mockResolvedValue({
        output: { tags: [], summary: "Summary only" },
      });

      const result = await generateHandler(ctx, {
        cardId: "c1",
        cardType: "text",
      });

      expect(result.aiSummary).toBe("Summary only");
      expect(mockRunMutation).toHaveBeenCalledWith(
        internal.workflows.aiMetadata.mutations.updateCardAI,
        expect.objectContaining({
          aiTags: undefined,
        })
      );
    });
  });
});
