// @ts-nocheck

import { describe, expect, mock, test } from "bun:test";
import { ConvexError } from "convex/values";
import {
  bulkCardsV1,
  cardByIdV1,
  changesCardsV1,
  favoriteCardsV1,
  listCardsV1,
  searchCardsV1,
  tagsV1,

} from "../publicApiHttp";
import {
  buildAuthorizedMutationMock,
  buildAuthorizedMutationMockWithIdempotencySkip,
  runHandler,
} from "./helpers/publicApiHttp.test-utils";

describe("publicApiHttp card endpoints", () => {
  test("searchCardsV1 returns items and total", async () => {
    const runMutation = buildAuthorizedMutationMock();
    const runQuery = mock().mockResolvedValue([]);

    const response = await runHandler(
      searchCardsV1,
      { runMutation, runQuery },
      new Request("https://example.com/v1/cards/search?limit=10", {
        method: "GET",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], total: 0 });
    expect(response.headers.get("Deprecation")).toBe("true");
    expect(response.headers.get("Link")).toContain("/v1/cards");
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ endpoint: "/v1/cards/search" })
    );
  });

  test("searchCardsV1 clamps invalid limit values", async () => {
    const runMutation = buildAuthorizedMutationMock();
    const runQuery = mock().mockResolvedValue([]);

    const response = await runHandler(
      searchCardsV1,
      { runMutation, runQuery },
      new Request("https://example.com/v1/cards/search?limit=999", {
        method: "GET",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runQuery.mock.calls[0][1].limit).toBe(100);
  });

  test("favoriteCardsV1 returns items and total", async () => {
    const runMutation = buildAuthorizedMutationMock();
    const runQuery = mock().mockResolvedValue([]);

    const response = await runHandler(
      favoriteCardsV1,
      { runMutation, runQuery },
      new Request("https://example.com/v1/cards/favorites?limit=10", {
        method: "GET",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], total: 0 });
  });

  test("favoriteCardsV1 returns 405 for non-GET methods", async () => {
    const response = await runHandler(
      favoriteCardsV1,
      { runMutation: mock(), runQuery: mock() },
      new Request("https://example.com/v1/cards/favorites", {
        method: "POST",
      })
    );

    expect(response.status).toBe(405);
    const payload = await response.json();
    expect(payload.code).toBe("METHOD_NOT_ALLOWED");
  });

  test("listCardsV1 returns paginated items with requested includes", async () => {
    const runMutation = buildAuthorizedMutationMock();
    const runQuery = mock().mockResolvedValueOnce({
      itemCursors: ["after-card-1"],
      items: [
        {
          _id: "card_1",
          type: "image",
          content: "Hello",
          url: "https://example.com",
          fileMetadata: {
            fileName: "image.png",
            fileSize: 123,
            mimeType: "image/png",
          },
          fileUrl: "https://files.example.com/image.png",
          detailUrl: "https://files.example.com/detail/image.png",
          tags: ["design"],
          aiTags: ["ui"],
          isFavorited: true,
          createdAt: 1,
          updatedAt: 2,
          metadataTitle: "Example",
          metadataDescription: "Desc",
        },
      ],
      nextCursor: null,
      scannedRows: 1,
    });

    const response = await runHandler(
      listCardsV1,
      { runMutation, runQuery },
      new Request(
        "https://example.com/v1/cards?limit=10&include=content,metadata",
        {
          method: "GET",
          headers: {
            Authorization:
              "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          },
        }
      )
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.pageInfo).toEqual({ hasMore: false, nextCursor: null });
    expect(payload.items[0].content).toBe("Hello");
    expect(payload.items[0].fileName).toBe("image.png");
    expect(payload.items[0].fileSize).toBe(123);
    expect(payload.items[0].mimeType).toBe("image/png");
    expect(payload.items[0].fileUrl).toBe(
      "https://files.example.com/image.png"
    );
    expect(payload.items[0].detailUrl).toBe(
      "https://files.example.com/detail/image.png"
    );
  });

  test("bulkCardsV1 executes bulk operations", async () => {
    const runMutation =
      buildAuthorizedMutationMockWithIdempotencySkip().mockResolvedValueOnce({
        operation: "favorite",
        results: [{ index: 0, status: "success", cardId: "card_1" }],
        summary: { total: 1, succeeded: 1, failed: 0 },
      });

    const response = await runHandler(
      bulkCardsV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards/bulk", {
        method: "POST",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operation: "favorite",
          items: [{ cardId: "card_1", isFavorited: true }],
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      operation: "favorite",
      results: [{ index: 0, status: "success", cardId: "card_1" }],
      summary: { total: 1, succeeded: 1, failed: 0 },
    });
  });

  test("bulkCardsV1 rejects requests over the item limit before fanning out", async () => {
    const runMutation = buildAuthorizedMutationMock();

    const response = await runHandler(
      bulkCardsV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards/bulk", {
        method: "POST",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operation: "favorite",
          items: Array.from({ length: 101 }, (_, index) => ({
            cardId: `card_${index}`,
            isFavorited: true,
          })),
        }),
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("INVALID_INPUT");
    expect(payload.error).toContain("100");
    // Only the two authorization mutations (validate key + rate limit) run;
    // neither idempotency reservation nor the bulk fan-out mutation fire.
    expect(runMutation).toHaveBeenCalledTimes(2);
  });

  test("bulkCardsV1 rejects an empty items array", async () => {
    const runMutation = buildAuthorizedMutationMock();

    const response = await runHandler(
      bulkCardsV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards/bulk", {
        method: "POST",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operation: "favorite",
          items: [],
        }),
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("INVALID_INPUT");
    expect(runMutation).toHaveBeenCalledTimes(2);
  });

  test("changesCardsV1 returns items and deleted ids", async () => {
    const runMutation = buildAuthorizedMutationMock();
    const runQuery = mock().mockResolvedValueOnce({
      items: [],
      deletedIds: ["card_2"],
      pageInfo: { hasMore: false, nextCursor: null },
    });

    const response = await runHandler(
      changesCardsV1,
      { runMutation, runQuery },
      new Request("https://example.com/v1/cards/changes?since=1&limit=10", {
        method: "GET",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [],
      deletedIds: ["card_2"],
      pageInfo: { hasMore: false, nextCursor: null },
    });
  });

  test("tagsV1 returns tag summaries", async () => {
    const runMutation = buildAuthorizedMutationMock();
    const runQuery = mock().mockResolvedValueOnce([
      { name: "design", count: 3 },
    ]);

    const response = await runHandler(
      tagsV1,
      { runMutation, runQuery },
      new Request("https://example.com/v1/tags", {
        method: "GET",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [{ name: "design", count: 3 }],
    });
  });

  test("cardByIdV1 returns 404 for invalid card id", async () => {
    const runMutation = buildAuthorizedMutationMock();
    const runQuery = mock().mockResolvedValueOnce(null);

    const response = await runHandler(
      cardByIdV1,
      { runMutation, runQuery },
      new Request("https://example.com/v1/cards/not-an-id", {
        method: "PATCH",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ notes: null }),
      })
    );

    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload.code).toBe("NOT_FOUND");
  });

  test("cardByIdV1 patches card fields", async () => {
    const runMutation = buildAuthorizedMutationMock().mockResolvedValueOnce({
      _id: "card_1",
      type: "text",
      content: "hello",
      notes: undefined,
      url: undefined,
      tags: [],
      aiTags: [],
      aiSummary: undefined,
      isFavorited: false,
      createdAt: 1,
      updatedAt: 2,
      fileUrl: undefined,
      thumbnailUrl: undefined,
      screenshotUrl: undefined,
      linkPreviewImageUrl: undefined,
      metadataTitle: undefined,
      metadataDescription: undefined,
    });
    const runQuery = mock()
      .mockResolvedValueOnce("card_1")
      .mockResolvedValueOnce({ _id: "card_1", userId: "user_1" });

    const response = await runHandler(
      cardByIdV1,
      { runMutation, runQuery },
      new Request("https://example.com/v1/cards/card_1", {
        method: "PATCH",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ notes: null, tags: [] }),
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.id).toBe("card_1");
    expect(payload.notes).toBeNull();
    expect(payload.tags).toEqual([]);
  });

  test("cardByIdV1 forwards raw Markdown updates without normalization", async () => {
    const content =
      "\uFEFF  # Heading\r\n\r\n- [ ] task  \r\nhttps://example.com  ";
    const runMutation = buildAuthorizedMutationMock().mockResolvedValueOnce({
      _id: "card_1",
      aiTags: [],
      content,
      createdAt: 1,
      isFavorited: false,
      tags: [],
      type: "text",
      updatedAt: 2,
      userId: "user_1",
    });
    const runQuery = mock()
      .mockResolvedValueOnce("card_1")
      .mockResolvedValueOnce({
        _id: "card_1",
        type: "text",
        userId: "user_1",
      });

    const response = await runHandler(
      cardByIdV1,
      { runMutation, runQuery },
      new Request("https://example.com/v1/cards/card_1", {
        method: "PATCH",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
      })
    );

    expect(response.status).toBe(200);
    expect(runMutation.mock.calls[2]?.[1]).toMatchObject({ content });
    expect((await response.json()).content).toBe(content);
  });

  test("cardByIdV1 keeps empty updates exclusive to text cards", async () => {
    const runMutation = buildAuthorizedMutationMock();
    const runQuery = mock()
      .mockResolvedValueOnce("card_1")
      .mockResolvedValueOnce({
        _id: "card_1",
        type: "quote",
        userId: "user_1",
      });

    const response = await runHandler(
      cardByIdV1,
      { runMutation, runQuery },
      new Request("https://example.com/v1/cards/card_1", {
        method: "PATCH",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "  \n" }),
      })
    );

    expect(response.status).toBe(400);
    expect(runMutation).toHaveBeenCalledTimes(2);
  });

  test("cardByIdV1 preserves stable text-size errors", async () => {
    const runMutation = buildAuthorizedMutationMock().mockRejectedValueOnce(
      new ConvexError({
        code: "CONTENT_TOO_LARGE",
        message:
          "Text card content must not exceed 512 KiB when encoded as UTF-8.",
      })
    );
    const runQuery = mock()
      .mockResolvedValueOnce("card_1")
      .mockResolvedValueOnce({
        _id: "card_1",
        type: "text",
        userId: "user_1",
      });

    const response = await runHandler(
      cardByIdV1,
      { runMutation, runQuery },
      new Request("https://example.com/v1/cards/card_1", {
        method: "PATCH",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: `${"a".repeat(512 * 1024)}b` }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "CONTENT_TOO_LARGE",
    });
  });

  test("cardByIdV1 rejects unsafe url scheme on patch", async () => {
    const runMutation = buildAuthorizedMutationMock();
    const runQuery = mock()
      .mockResolvedValueOnce("card_1")
      .mockResolvedValueOnce({ _id: "card_1", userId: "user_1" });

    const response = await runHandler(
      cardByIdV1,
      { runMutation, runQuery },
      new Request("https://example.com/v1/cards/card_1", {
        method: "PATCH",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: "javascript:alert(1)" }),
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("INVALID_INPUT");
  });

  test("cardByIdV1 rejects invalid favorite payload", async () => {
    const runMutation = buildAuthorizedMutationMock();
    const runQuery = mock()
      .mockResolvedValueOnce("card_1")
      .mockResolvedValueOnce({ _id: "card_1", userId: "user_1" });

    const response = await runHandler(
      cardByIdV1,
      { runMutation, runQuery },
      new Request("https://example.com/v1/cards/card_1/favorite", {
        method: "PATCH",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ isFavorited: "yes" }),
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("INVALID_INPUT");
  });

  test("cardByIdV1 supports soft delete", async () => {
    const runMutation =
      buildAuthorizedMutationMock().mockResolvedValueOnce(null);
    const runQuery = mock()
      .mockResolvedValueOnce("card_1")
      .mockResolvedValueOnce({ _id: "card_1", userId: "user_1" });

    const response = await runHandler(
      cardByIdV1,
      { runMutation, runQuery },
      new Request("https://example.com/v1/cards/card_1", {
        method: "DELETE",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      })
    );

    expect(response.status).toBe(204);
  });

  test("cardByIdV1 hides soft-deleted cards from direct reads", async () => {
    const runMutation = buildAuthorizedMutationMock();
    const runQuery = mock()
      .mockResolvedValueOnce("card_1")
      .mockResolvedValueOnce({
        _id: "card_1",
        isDeleted: true,
        userId: "user_1",
      });

    const response = await runHandler(
      cardByIdV1,
      { runMutation, runQuery },
      new Request("https://example.com/v1/cards/card_1", {
        method: "GET",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  test("cardByIdV1 rejects updates to soft-deleted cards", async () => {
    const runMutation = buildAuthorizedMutationMock();
    const runQuery = mock()
      .mockResolvedValueOnce("card_1")
      .mockResolvedValueOnce({
        _id: "card_1",
        isDeleted: true,
        userId: "user_1",
      });

    const response = await runHandler(
      cardByIdV1,
      { runMutation, runQuery },
      new Request("https://example.com/v1/cards/card_1", {
        method: "PATCH",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ notes: "should not update" }),
      })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(runMutation).toHaveBeenCalledTimes(2);
  });
});
