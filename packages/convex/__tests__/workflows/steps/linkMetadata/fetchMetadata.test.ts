// @ts-nocheck
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

mock.module("ai", () => ({
  generateObject: mock(),
  experimental_transcribe: mock(),
}));

const mockCreateSecret = mock();
const mockKernelExecute = mock();
const mockKernelCreateBrowser = mock();
const mockDeleteByID = mock();

const mockParseLinkPreview = mock();
const mockBuildSuccessPreview = mock();
const mockBuildErrorPreview = mock();
const mockNormalizeInstagramExtractedMedia = mock();

mock.module("../../../../../convex/linkMetadata", () => ({
  buildInstagramPrimaryImageSnippet: () => "",
  normalizeUrl: (url) => url,
  parseLinkPreview: mockParseLinkPreview,
  buildSuccessPreview: mockBuildSuccessPreview,
  buildErrorPreview: mockBuildErrorPreview,
  isInstagramPostUrl: (url) => /instagram\.com\/(p|reel)\//.test(url),
  isInstagramUrl: (url) => /instagram\.com/.test(url),
  normalizeInstagramExtractedMedia: mockNormalizeInstagramExtractedMedia,
  SCRAPE_ELEMENTS: [],
}));

mock.module("@onkernel/sdk", () => {
  return {
    default: class MockKernel {
      secrets = { create: mockCreateSecret };
      browsers = {
        create: mockKernelCreateBrowser,
        deleteByID: mockDeleteByID,
        playwright: { execute: mockKernelExecute },
      };
    },
  };
});

import { internal } from "../../../../../convex/_generated/api";
import { fetchMetadataHandler } from "../../../../../convex/workflows/steps/linkMetadata/fetchMetadata";

const VALID_PNG_BYTES = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
  0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218,
  99, 252, 255, 31, 0, 3, 3, 2, 0, 239, 154, 15, 219, 0, 0, 0, 0, 73, 69, 78,
  68, 174, 66, 96, 130,
]);

describe("fetchMetadata", () => {
  const mockRunQuery = mock();
  const mockRunMutation = mock();
  const mockStorageStore = mock();
  const ctx = {
    runQuery: mockRunQuery,
    runMutation: mockRunMutation,
    storage: {
      store: mockStorageStore,
    },
  } as any;

  const originalFetch = global.fetch;
  const mockFetch = mock();

  beforeAll(() => {
    global.fetch = mockFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    mockRunQuery.mockReset();
    mockRunMutation.mockReset();
    mockCreateSecret.mockReset();
    mockKernelExecute.mockReset();
    mockKernelCreateBrowser.mockReset();
    mockDeleteByID.mockReset();
    mockFetch.mockReset();
    mockParseLinkPreview.mockReset();
    mockBuildSuccessPreview.mockReset();
    mockBuildErrorPreview.mockReset();
    mockNormalizeInstagramExtractedMedia.mockReset();
    mockStorageStore.mockReset();

    // Standard mock resolutions
    mockKernelCreateBrowser.mockResolvedValue({ session_id: "s1" });
    mockParseLinkPreview.mockReturnValue({});
    mockBuildSuccessPreview.mockReturnValue({});
    mockBuildErrorPreview.mockImplementation((url, error) => ({ url, error }));
    mockNormalizeInstagramExtractedMedia.mockReturnValue(undefined);
    mockStorageStore.mockImplementation(async () => "stored-asset");

    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => "text/html" },
      text: async () => "",
    });
  });

  test("handles missing card", async () => {
    mockRunQuery.mockResolvedValue(null);
    await fetchMetadataHandler(ctx, { cardId: "c1" });
    expect(mockRunMutation).toHaveBeenCalledWith(
      internal.linkMetadata.updateCardMetadata,
      expect.objectContaining({
        cardId: "c1",
        status: "failed",
        linkPreview: expect.objectContaining({
          error: expect.objectContaining({ type: "invalid_card" }),
        }),
      })
    );
  });

  test("handles card without url", async () => {
    mockRunQuery.mockResolvedValue({ _id: "c1" });
    await fetchMetadataHandler(ctx, { cardId: "c1" });
    expect(mockRunMutation).toHaveBeenCalledWith(
      internal.linkMetadata.updateCardMetadata,
      expect.any(Object)
    );
  });

  test("handles non-link card", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "text",
      url: "https://example.com",
      processingStatus: { classify: { status: "completed" } },
    });
    await fetchMetadataHandler(ctx, { cardId: "c1" });
    expect(mockRunMutation).toHaveBeenCalled();
  });

  test("throws retryable if awaiting classification", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      metadata: { linkCategory: { status: "pending" } },
    });

    expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(
      /retryable/
    );
  });

  test("successful scrape", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      metadata: { linkCategory: { status: "completed" } },
    });
    mockKernelExecute.mockResolvedValue({
      success: true,
      result: [{ selector: "title", results: [{ text: "Title" }] }],
    });

    const result = await fetchMetadataHandler(ctx, { cardId: "c1" });
    expect(result.status).toBe("success");
    expect(mockRunMutation).toHaveBeenCalledWith(
      internal.linkMetadata.updateCardMetadata,
      expect.objectContaining({
        cardId: "c1",
        status: "completed",
      })
    );
  });

  test("stores instagram post media in link preview metadata", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://www.instagram.com/p/DBY4WfSxA0a/",
      metadata: { linkCategory: { status: "completed" } },
    });
    mockKernelExecute.mockResolvedValue({
      success: true,
      result: {
        selectors: [],
        instagramMedia: [{ url: "https://cdninstagram.com/media/raw.jpg" }],
      },
    });
    mockParseLinkPreview.mockReturnValue({ title: "Instagram post" });
    mockNormalizeInstagramExtractedMedia.mockReturnValue([
      {
        type: "image",
        url: "https://cdninstagram.com/media/one.jpg",
        contentType: "image/jpeg",
        width: 1080,
        height: 1350,
      },
      {
        type: "video",
        url: "https://cdninstagram.com/media/two.mp4",
        contentType: "video/mp4",
        width: 720,
        height: 1280,
        posterUrl: "https://cdninstagram.com/media/two.jpg",
        posterContentType: "image/jpeg",
        posterWidth: 720,
        posterHeight: 1280,
      },
    ]);
    let storageCounter = 0;
    mockStorageStore.mockImplementation(
      async () => `stored-${++storageCounter}`
    );
    mockFetch.mockImplementation(async (input: string | URL | Request) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.toString()
            : input;

      if (typeof url === "string") {
        const hostname = new URL(url).hostname;
        if (hostname === "cdninstagram.com") {
          return {
            ok: true,
            status: 200,
            headers: {
              get: (header: string) =>
                header === "content-type"
                  ? url.endsWith(".mp4")
                    ? "video/mp4"
                    : "image/jpeg"
                  : null,
            },
            arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
          };
        }
      }

      throw new Error(`Unexpected fetch URL: ${String(url)}`);
    });

    const result = await fetchMetadataHandler(ctx, { cardId: "c1" });

    expect(result.status).toBe("success");
    expect(mockNormalizeInstagramExtractedMedia).toHaveBeenCalled();
    expect(mockBuildSuccessPreview).toHaveBeenCalledWith(
      "https://www.instagram.com/p/DBY4WfSxA0a/",
      expect.objectContaining({
        title: "Instagram post",
        media: [
          expect.objectContaining({
            type: "image",
            storageId: "stored-1",
          }),
          expect.objectContaining({
            type: "video",
            storageId: "stored-2",
            posterStorageId: "stored-3",
          }),
        ],
      })
    );
  });

  test("falls back to preview-only metadata for instagram posts without downloadable media", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://www.instagram.com/reel/Cr9Lx2xJ0Ab/",
      metadata: { linkCategory: { status: "completed" } },
    });
    mockKernelExecute.mockResolvedValue({
      success: true,
      result: {
        selectors: [],
        instagramMedia: [],
        primaryImage: {
          url: "https://cdninstagram.com/media/poster.jpg",
        },
      },
    });
    mockParseLinkPreview.mockReturnValue({
      title: "Instagram reel",
      imageUrl: "https://cdninstagram.com/media/poster.jpg",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (header: string) =>
          header === "content-type" ? "image/jpeg" : null,
      },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });

    const result = await fetchMetadataHandler(ctx, { cardId: "c1" });

    expect(result.status).toBe("success");
    expect(mockBuildSuccessPreview).toHaveBeenCalledWith(
      "https://www.instagram.com/reel/Cr9Lx2xJ0Ab/",
      expect.objectContaining({
        title: "Instagram reel",
      })
    );
    expect(mockRunMutation).toHaveBeenCalledWith(
      internal.linkMetadata.updateCardMetadata,
      expect.objectContaining({
        status: "completed",
      })
    );
  });

  test("stores a preview image when instagram media cannot be persisted", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://www.instagram.com/reel/Cr9Lx2xJ0Ab/",
      metadata: { linkCategory: { status: "completed" } },
    });
    mockKernelExecute.mockResolvedValue({
      success: true,
      result: {
        selectors: [],
        instagramMedia: [{ url: "https://cdninstagram.com/media/raw.mp4" }],
      },
    });
    mockParseLinkPreview.mockReturnValue({
      title: "Instagram reel",
      imageUrl: "https://cdninstagram.com/media/poster.png",
    });
    mockNormalizeInstagramExtractedMedia.mockReturnValue([
      {
        type: "video",
        url: "https://cdninstagram.com/media/reel.mp4",
        contentType: "video/mp4",
        posterUrl: "https://cdninstagram.com/media/poster.png",
        posterContentType: "image/png",
      },
    ]);
    mockFetch.mockImplementation(async (input: string | URL | Request) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.toString()
            : input;

      if (url === "https://cdninstagram.com/media/reel.mp4") {
        return {
          ok: false,
          status: 403,
          headers: { get: () => null },
        };
      }

      if (url === "https://cdninstagram.com/media/poster.png") {
        return {
          ok: true,
          status: 200,
          headers: {
            get: (header: string) =>
              header === "content-type" ? "image/png" : null,
          },
          arrayBuffer: async () => VALID_PNG_BYTES.buffer,
        };
      }

      throw new Error(`Unexpected fetch URL: ${String(url)}`);
    });

    const result = await fetchMetadataHandler(ctx, { cardId: "c1" });

    expect(result.status).toBe("success");
    expect(mockStorageStore).toHaveBeenCalledTimes(1);
    expect(mockBuildSuccessPreview).toHaveBeenCalledWith(
      "https://www.instagram.com/reel/Cr9Lx2xJ0Ab/",
      expect.objectContaining({
        title: "Instagram reel",
        imageUrl: "https://cdninstagram.com/media/poster.png",
      })
    );
  });

  test("uses X oEmbed metadata for status URLs before scraping", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://x.com/jack/status/20",
      metadata: { linkCategory: { status: "completed" } },
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        author_name: "jack",
        author_url: "https://x.com/jack",
        html: `<blockquote class="twitter-tweet"><p lang="en" dir="ltr">just setting up my twttr</p>&mdash; jack (@jack) <a href="https://x.com/jack/status/20">March 21, 2006</a></blockquote>`,
        url: "https://x.com/jack/status/20",
      }),
    });

    const result = await fetchMetadataHandler(ctx, { cardId: "c1" });

    expect(result.status).toBe("success");
    expect(mockKernelExecute).not.toHaveBeenCalled();
    expect(mockParseLinkPreview).not.toHaveBeenCalled();
    expect(mockRunMutation).toHaveBeenCalledWith(
      internal.linkMetadata.updateCardMetadata,
      expect.objectContaining({
        cardId: "c1",
        status: "completed",
      })
    );
  });

  test("handles scrape failure (retryable)", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      metadata: { linkCategory: { status: "completed" } },
    });
    mockKernelExecute.mockResolvedValue({
      success: false,
      error: "Timeout error",
    });

    expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(
      /retryable/
    );
  });

  test("handles rate limit failure (retryable)", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      metadata: { linkCategory: { status: "completed" } },
    });
    mockKernelExecute.mockResolvedValue({
      success: false,
      error: "Rate limit exceeded",
    });

    expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(
      /rate_limit/
    );
  });

  test("falls back to html fetch when kernel fails", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      metadata: { linkCategory: { status: "completed" } },
    });
    mockKernelExecute.mockResolvedValue({
      success: false,
      error: "Timeout error",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "text/html" },
      text: async () =>
        '<html><head><title>Shader Lines</title><meta property="og:title" content="Shader Lines" /></head></html>',
    });

    const result = await fetchMetadataHandler(ctx, { cardId: "c1" });
    expect(result.status).toBe("success");
    expect(mockRunMutation).toHaveBeenCalledWith(
      internal.linkMetadata.updateCardMetadata,
      expect.objectContaining({ status: "completed" })
    );
  });

  test("handles browser cleanup failure", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      processingStatus: { classify: { status: "completed" } },
    });
    mockKernelExecute.mockResolvedValue({ success: true, result: [] });
    mockDeleteByID.mockRejectedValue(new Error("Cleanup failed"));

    const result = await fetchMetadataHandler(ctx, { cardId: "c1" });
    expect(result.status).toBe("success");
    // Should have logged warning but succeeded
  });

  test("throws retryable if non-link card is still being classified", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "text", // not a link
      url: "https://example.com",
      processingStatus: { classify: { status: "pending" } },
    });

    expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(
      /awaiting_classification/
    );
  });

  test("handles AbortError (timeout)", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      processingStatus: { classify: { status: "completed" } },
    });
    mockKernelCreateBrowser.mockResolvedValue({ session_id: "s1" });
    mockKernelExecute.mockResolvedValue({ success: true, result: [] });

    // Make parsing throw AbortError
    const abortError = new Error("Abort");
    abortError.name = "AbortError";
    mockParseLinkPreview.mockImplementation(() => {
      throw abortError;
    });

    expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(
      /timeout/
    );
  });

  test("handles TypeError (network)", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      processingStatus: { classify: { status: "completed" } },
    });
    mockKernelCreateBrowser.mockResolvedValue({ session_id: "s1" });
    mockKernelExecute.mockResolvedValue({ success: true, result: [] });

    // Make parsing throw TypeError with fetch
    const typeError = new TypeError("Failed to fetch");
    mockParseLinkPreview.mockImplementation(() => {
      throw typeError;
    });

    expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(
      /network_error/
    );
  });

  test("handles non-retryable error during metadata extraction", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      processingStatus: { classify: { status: "completed" } },
    });
    mockKernelCreateBrowser.mockResolvedValue({ session_id: "s1" });
    mockKernelExecute.mockResolvedValue({ success: true, result: [] });

    mockParseLinkPreview.mockImplementation(() => {
      throw new Error("Fatal error");
    });
    mockBuildErrorPreview.mockReturnValue({ error: "built error" });

    const result = await fetchMetadataHandler(ctx, { cardId: "c1" });
    expect(result.status).toBe("failed");
    expect(mockRunMutation).toHaveBeenCalledWith(
      internal.linkMetadata.updateCardMetadata,
      expect.objectContaining({
        status: "failed",
      })
    );
  });

  test("handles kernel creation failure", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      metadata: { linkCategory: { status: "completed" } },
    });
    // Make create browser throw
    mockKernelCreateBrowser.mockRejectedValue(
      new Error("Failed to create browser")
    );

    // Should be treated as a scrape error (retryable) because scrapeWithKernel catches it and returns success: false
    expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(
      /retryable/
    );
  });
});
