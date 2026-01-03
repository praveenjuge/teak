// @ts-nocheck
import { describe, expect, test, beforeEach, beforeAll, mock, afterAll } from "bun:test";

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

mock.module("../../../../../convex/linkMetadata", () => ({
  normalizeUrl: (url) => url,
  parseLinkPreview: mockParseLinkPreview,
  buildSuccessPreview: mockBuildSuccessPreview,
  buildErrorPreview: mockBuildErrorPreview,
  SCRAPE_ELEMENTS: [],
}));

mock.module("@onkernel/sdk", () => {
  return {
    default: class MockKernel {
      secrets = { create: mockCreateSecret };
      browsers = {
        create: mockKernelCreateBrowser,
        deleteByID: mockDeleteByID,
        playwright: { execute: mockKernelExecute }
      };
    }
  };
});

import { fetchMetadataHandler } from '../../../../../convex/workflows/steps/linkMetadata/fetchMetadata';
import { internal } from '../../../../../convex/_generated/api';

describe("fetchMetadata", () => {
  const mockRunQuery = mock();
  const mockRunMutation = mock();
  const ctx = {
    runQuery: mockRunQuery,
    runMutation: mockRunMutation
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

    // Standard mock resolutions
    mockKernelCreateBrowser.mockResolvedValue({ session_id: "s1" });
    mockParseLinkPreview.mockReturnValue({});
    mockBuildSuccessPreview.mockReturnValue({});
    mockBuildErrorPreview.mockImplementation((url, error) => ({ url, error }));

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
    expect(mockRunMutation).toHaveBeenCalledWith(internal.linkMetadata.updateCardMetadata, expect.objectContaining({
      cardId: "c1",
      status: "failed",
      linkPreview: expect.objectContaining({ error: expect.objectContaining({ type: "invalid_card" }) })
    }));
  });

  test("handles card without url", async () => {
    mockRunQuery.mockResolvedValue({ _id: "c1" });
    await fetchMetadataHandler(ctx, { cardId: "c1" });
    expect(mockRunMutation).toHaveBeenCalledWith(internal.linkMetadata.updateCardMetadata, expect.any(Object));
  });

  test("handles non-link card", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "text",
      url: "https://example.com",
      processingStatus: { classify: { status: "completed" } }
    });
    await fetchMetadataHandler(ctx, { cardId: "c1" });
    expect(mockRunMutation).toHaveBeenCalled();
  });

  test("throws retryable if awaiting classification", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      metadata: { linkCategory: { status: "pending" } }
    });

    expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(/retryable/);
  });

  test("successful scrape", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      metadata: { linkCategory: { status: "completed" } }
    });
    mockKernelExecute.mockResolvedValue({
      success: true,
      result: [{ selector: "title", results: [{ text: "Title" }] }]
    });

    const result = await fetchMetadataHandler(ctx, { cardId: "c1" });
    expect(result.status).toBe("success");
    expect(mockRunMutation).toHaveBeenCalledWith(internal.linkMetadata.updateCardMetadata, expect.objectContaining({
      cardId: "c1",
      status: "completed",
    }));
  });

  test("handles scrape failure (retryable)", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      metadata: { linkCategory: { status: "completed" } }
    });
    mockKernelExecute.mockResolvedValue({
      success: false,
      error: "Timeout error"
    });

    expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(/retryable/);
  });

  test("handles rate limit failure (retryable)", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      metadata: { linkCategory: { status: "completed" } }
    });
    mockKernelExecute.mockResolvedValue({
      success: false,
      error: "Rate limit exceeded"
    });

    expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(/rate_limit/);
  });

  test("falls back to html fetch when kernel fails", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      metadata: { linkCategory: { status: "completed" } }
    });
    mockKernelExecute.mockResolvedValue({
      success: false,
      error: "Timeout error"
    });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "text/html" },
      text: async () =>
        "<html><head><title>Shader Lines</title><meta property=\"og:title\" content=\"Shader Lines\" /></head></html>",
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
      processingStatus: { classify: { status: "completed" } }
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
      processingStatus: { classify: { status: "pending" } }
    });

    expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(/awaiting_classification/);
  });

  test("handles AbortError (timeout)", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      processingStatus: { classify: { status: "completed" } }
    });
    mockKernelCreateBrowser.mockResolvedValue({ session_id: "s1" });
    mockKernelExecute.mockResolvedValue({ success: true, result: [] });

    // Make parsing throw AbortError
    const abortError = new Error("Abort");
    abortError.name = "AbortError";
    mockParseLinkPreview.mockImplementation(() => { throw abortError; });

    expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(/timeout/);
  });

  test("handles TypeError (network)", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      processingStatus: { classify: { status: "completed" } }
    });
    mockKernelCreateBrowser.mockResolvedValue({ session_id: "s1" });
    mockKernelExecute.mockResolvedValue({ success: true, result: [] });

    // Make parsing throw TypeError with fetch
    const typeError = new TypeError("Failed to fetch");
    mockParseLinkPreview.mockImplementation(() => { throw typeError; });

    expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(/network_error/);
  });

  test("handles non-retryable error during metadata extraction", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      processingStatus: { classify: { status: "completed" } }
    });
    mockKernelCreateBrowser.mockResolvedValue({ session_id: "s1" });
    mockKernelExecute.mockResolvedValue({ success: true, result: [] });

    mockParseLinkPreview.mockImplementation(() => { throw new Error("Fatal error"); });
    mockBuildErrorPreview.mockReturnValue({ error: "built error" });

    const result = await fetchMetadataHandler(ctx, { cardId: "c1" });
    expect(result.status).toBe("failed");
    expect(mockRunMutation).toHaveBeenCalledWith(internal.linkMetadata.updateCardMetadata, expect.objectContaining({
      status: "failed"
    }));
  });

  test("handles kernel creation failure", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      metadata: { linkCategory: { status: "completed" } }
    });
    // Make create browser throw
    mockKernelCreateBrowser.mockRejectedValue(new Error("Failed to create browser"));

    // Should be treated as a scrape error (retryable) because scrapeWithKernel catches it and returns success: false
    expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(/retryable/);
  });
});
