// @ts-nocheck
import { describe, expect, test, mock, beforeEach } from "bun:test";
import { fetchMetadataHandler, LINK_METADATA_RETRYABLE_PREFIX } from "./fetchMetadata";

// Mock @onkernel/sdk
const mockExecute = mock();
const mockCreateBrowser = mock();
const mockDeleteBrowser = mock();

mock.module("@onkernel/sdk", () => {
  return class Kernel {
    browsers = {
      create: mockCreateBrowser,
      playwright: { execute: mockExecute },
      deleteByID: mockDeleteBrowser,
    };
  };
});

// Mock internal API
const mockInternal = {
  linkMetadata: {
    getCardForMetadata: "getCardForMetadata",
    updateCardMetadata: "updateCardMetadata",
  },
};
mock.module("../../../_generated/api", () => ({
  internal: mockInternal,
}));

describe("fetchMetadata", () => {
  const mockRunQuery = mock();
  const mockRunMutation = mock();
  const ctx = {
    runQuery: mockRunQuery,
    runMutation: mockRunMutation,
  } as any;

  beforeEach(() => {
    mockRunQuery.mockReset();
    mockRunMutation.mockReset();
    mockExecute.mockReset();
    mockCreateBrowser.mockReset();
    mockDeleteBrowser.mockReset();
  });

  test("handles missing card", async () => {
    mockRunQuery.mockResolvedValue(null);
    const result = await fetchMetadataHandler(ctx, { cardId: "c1" });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("Card is missing a valid URL");
    expect(mockRunMutation).toHaveBeenCalled();
  });

  test("handles card without url", async () => {
    mockRunQuery.mockResolvedValue({ _id: "c1" });
    const result = await fetchMetadataHandler(ctx, { cardId: "c1" });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("Card is missing a valid URL");
  });

  test("handles non-link card", async () => {
    mockRunQuery.mockResolvedValue({ _id: "c1", url: "https://example.com", type: "note" });
    const result = await fetchMetadataHandler(ctx, { cardId: "c1" });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("Card is not a link");
  });

  test("throws retryable if awaiting classification", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      url: "https://example.com",
      type: "note",
      processingStatus: { classify: { status: "pending" } },
    });
    
    expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(LINK_METADATA_RETRYABLE_PREFIX);
  });

  test("successful scrape", async () => {
    mockRunQuery.mockResolvedValue({ _id: "c1", url: "https://example.com", type: "link" });
    mockCreateBrowser.mockResolvedValue({ session_id: "sess_1" });
    mockExecute.mockResolvedValue({
      success: true,
      result: [
        { selector: "title", results: [{ text: "Page Title" }] }
      ]
    });

    const result = await fetchMetadataHandler(ctx, { cardId: "c1" });
    expect(result.status).toBe("success");
    expect(result.linkPreview.title).toBe("Page Title");
    expect(mockRunMutation).toHaveBeenCalledWith(
        mockInternal.linkMetadata.updateCardMetadata,
        expect.objectContaining({ status: "completed" })
    );
    expect(mockDeleteBrowser).toHaveBeenCalledWith("sess_1");
  });

  test("handles scrape failure (retryable)", async () => {
    mockRunQuery.mockResolvedValue({ _id: "c1", url: "https://example.com", type: "link" });
    mockCreateBrowser.mockResolvedValue({ session_id: "sess_1" });
    mockExecute.mockResolvedValue({
      success: false,
      error: "Timeout error",
    });

    try {
        await fetchMetadataHandler(ctx, { cardId: "c1" });
        throw new Error("Should have thrown");
    } catch (e: any) {
        expect(e.message).toContain(LINK_METADATA_RETRYABLE_PREFIX);
        expect(e.message).toContain("scrape_error");
    }
  });

  test("handles rate limit failure (retryable)", async () => {
    mockRunQuery.mockResolvedValue({ _id: "c1", url: "https://example.com", type: "link" });
    mockCreateBrowser.mockResolvedValue({ session_id: "sess_1" });
    mockExecute.mockResolvedValue({
      success: false,
      error: "Rate limit exceeded",
    });

    try {
        await fetchMetadataHandler(ctx, { cardId: "c1" });
        throw new Error("Should have thrown");
    } catch (e: any) {
        expect(e.message).toContain(LINK_METADATA_RETRYABLE_PREFIX);
        expect(e.message).toContain("rate_limit");
    }
  });

  test("handles unexpected error", async () => {
    mockRunQuery.mockResolvedValue({ _id: "c1", url: "https://example.com", type: "link" });
    mockCreateBrowser.mockRejectedValue(new Error("Kernel exploded"));

    const result = await fetchMetadataHandler(ctx, { cardId: "c1" });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("Kernel exploded");
    expect(mockRunMutation).toHaveBeenCalledWith(
        mockInternal.linkMetadata.updateCardMetadata,
        expect.objectContaining({ status: "failed" })
    );
  });
});
