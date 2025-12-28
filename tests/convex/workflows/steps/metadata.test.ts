// @ts-nocheck
import { mock, describe, expect, test, beforeEach, beforeAll, afterAll } from "bun:test";

const aiMocks = (global as any).__AI_MOCKS__ || {
  generateObject: mock(),
  experimental_transcribe: mock(),
};
(global as any).__AI_MOCKS__ = aiMocks;

mock.module("ai", () => aiMocks);

// Mock internal API
import { internal } from "../../../../convex/_generated/api";

const originalFetch = global.fetch;
const mockFetch = mock();
global.fetch = mockFetch as any;

import { generateHandler, buildLinkContentParts } from "../../../../convex/workflows/steps/metadata";

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
          publishedAt: "Date"
        }
      }
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
});

describe("metadata handler", () => {
  const mockRunQuery = mock();
  const mockRunMutation = mock();
  const mockGetUrl = mock();
  const mockScheduler = { runAfter: mock() };
  const ctx = {
    runQuery: mockRunQuery,
    runMutation: mockRunMutation,
    storage: { getUrl: mockGetUrl },
    scheduler: mockScheduler,
  } as any;

  beforeEach(() => {
    mockRunQuery.mockReset();
    mockRunMutation.mockReset();
    mockGetUrl.mockReset();
    mockScheduler.runAfter.mockReset();
    aiMocks.generateObject.mockReset();
    aiMocks.experimental_transcribe.mockReset();
    mockFetch.mockReset();
  });

  test("throws if card not found", async () => {
    mockRunQuery.mockResolvedValue(null);
    expect(generateHandler(ctx, { cardId: "c1", cardType: "text" })).rejects.toThrow("Card c1 not found");
  });

  test("handles text card", async () => {
    mockRunQuery.mockResolvedValue({ _id: "c1", content: "hello" });
    aiMocks.generateObject.mockResolvedValue({ object: { tags: ["tag1"], summary: "summary" } });

    const result = await generateHandler(ctx, { cardId: "c1", cardType: "text" });
    expect(result.aiTags).toEqual(["tag1"]);
    expect(mockRunMutation).toHaveBeenCalled();
  });

  test("handles image card", async () => {
    mockRunQuery.mockResolvedValue({ _id: "c1", fileId: "f1" });
    mockGetUrl.mockResolvedValue("https://image");
    aiMocks.generateObject.mockResolvedValue({ object: { tags: ["img"], summary: "img sum" } });

    const result = await generateHandler(ctx, { cardId: "c1", cardType: "image" });
    expect(result.aiTags).toEqual(["img"]);
  });

  test("handles video card using thumbnail", async () => {
    mockRunQuery.mockResolvedValue({ _id: "c1", thumbnailId: "t1" });
    mockGetUrl.mockResolvedValue("https://thumb");
    aiMocks.generateObject.mockResolvedValue({ object: { tags: ["video"], summary: "video sum" } });

    const result = await generateHandler(ctx, { cardId: "c1", cardType: "video" });
    expect(result.aiTags).toEqual(["video"]);
    expect(mockGetUrl).toHaveBeenCalledWith("t1");
  });

  test("handles audio card with transcript", async () => {
    mockRunQuery.mockResolvedValue({ _id: "c1", fileId: "a1", fileMetadata: { mimeType: "audio/mp3" } });
    mockGetUrl.mockResolvedValue("https://audio");
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => "audio/mp3" },
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    aiMocks.experimental_transcribe.mockResolvedValue({ text: "transcript text" });
    aiMocks.generateObject.mockResolvedValue({ object: { tags: ["audio"], summary: "audio sum" } });

    const result = await generateHandler(ctx, { cardId: "c1", cardType: "audio" });
    expect(result.aiTranscript).toBe("transcript text");
    expect(result.aiTags).toEqual(["audio"]);
  });

  test("handles link card and schedules screenshot", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      url: "https://example.com",
      metadata: { linkPreview: { status: "success", title: "Site" } }
    });
    aiMocks.generateObject.mockResolvedValue({ object: { tags: ["link"], summary: "link sum" } });

    const result = await generateHandler(ctx, { cardId: "c1", cardType: "link" });
    expect(result.aiTags).toEqual(["link"]);
    expect(mockScheduler.runAfter).toHaveBeenCalled();
  });

  test("handles document card", async () => {
    mockRunQuery.mockResolvedValue({ _id: "c1", content: "doc content", fileMetadata: { fileName: "test.pdf" } });
    aiMocks.generateObject.mockResolvedValue({ object: { tags: ["doc"], summary: "doc sum" } });

    const result = await generateHandler(ctx, { cardId: "c1", cardType: "document" });
    expect(result.aiTags).toEqual(["doc"]);
  });

  test("handles quote card", async () => {
    mockRunQuery.mockResolvedValue({ _id: "c1", content: "to be or not to be" });
    aiMocks.generateObject.mockResolvedValue({ object: { tags: ["quote"], summary: "quote sum" } });

    const result = await generateHandler(ctx, { cardId: "c1", cardType: "quote" });
    expect(result.aiTags).toEqual(["quote"]);
  });

  test("handles palette card", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      colors: [{ hex: "#ff0000", name: "Red" }]
    });
    aiMocks.generateObject.mockResolvedValue({ object: { tags: ["color"], summary: "color sum" } });

    const result = await generateHandler(ctx, { cardId: "c1", cardType: "palette" });
    expect(result.aiTags).toEqual(["color"]);
  });

  test("throws if no metadata generated", async () => {
    mockRunQuery.mockResolvedValue({ _id: "c1", content: "" });
    aiMocks.generateObject.mockResolvedValue({ object: { tags: [], summary: "" } });
    // results will be empty
    expect(generateHandler(ctx, { cardId: "c1", cardType: "text" })).rejects.toThrow("No AI metadata generated");
  });

  test("throws if link metadata is pending", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      url: "https://example.com",
      metadataStatus: "pending",
      metadata: {}
    });
    expect(generateHandler(ctx, { cardId: "c1", cardType: "link" })).rejects.toThrow("Link metadata extraction not yet complete");
  });
});
