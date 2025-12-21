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

mock.module("@onkernel/sdk", () => {
  return {
    default: class MockKernel {
      secrets = { create: mockCreateSecret };
      browsers = {
        create: mockKernelCreateBrowser.mockResolvedValue({ session_id: "s1" }),
        deleteByID: mockDeleteByID,
        playwright: { execute: mockKernelExecute }
      };
    }
  };
});

import { fetchMetadataHandler } from "./fetchMetadata";
import { internal } from "../../../_generated/api";

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

    // Standard mock resolutions
    mockKernelCreateBrowser.mockResolvedValue({ session_id: "s1" });
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

  test("handles unexpected error", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      metadata: { linkCategory: { status: "completed" } }
    });
    mockKernelExecute.mockRejectedValue(new Error("Unexpected"));

    expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(/retryable/);
  });
});
