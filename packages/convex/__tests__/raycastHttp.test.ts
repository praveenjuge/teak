// @ts-nocheck

import { describe, expect, mock, test } from "bun:test";
import { ConvexError } from "convex/values";
import {
  cardByIdV1,
  createCardV1,
  favoriteCards,
  favoriteCardsV1,
  quickSave,
  searchCards,
  searchCardsV1,
} from "../raycastHttp";

const runHandler = async (fn: any, ctx: any, request: Request) => {
  const handler = (fn as any).handler ?? fn;
  return handler(ctx, request);
};

const buildAuthorizedMutationMock = () =>
  mock()
    .mockResolvedValueOnce({ ok: true, retryAt: undefined })
    .mockResolvedValueOnce({
      keyId: "key_1",
      userId: "user_1",
      access: "full_access",
    });

describe("raycastHttp", () => {
  test("quickSave returns 405 for non-POST methods", async () => {
    const response = await runHandler(
      quickSave,
      { runMutation: mock(), runQuery: mock() },
      new Request("https://example.com/api/raycast/quick-save", {
        method: "GET",
      })
    );

    expect(response.status).toBe(405);
    const payload = await response.json();
    expect(payload.code).toBe("METHOD_NOT_ALLOWED");
  });

  test("quickSave returns 401 without bearer token", async () => {
    const response = await runHandler(
      quickSave,
      { runMutation: mock(), runQuery: mock() },
      new Request("https://example.com/api/raycast/quick-save", {
        method: "POST",
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.code).toBe("UNAUTHORIZED");
  });

  test("quickSave returns 429 when rate limited", async () => {
    const runMutation = mock().mockResolvedValueOnce({
      ok: false,
      retryAt: Date.now() + 30_000,
    });

    const response = await runHandler(
      quickSave,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/api/raycast/quick-save", {
        method: "POST",
        headers: {
          Authorization: "Bearer teakapi_abc_secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(429);
    const payload = await response.json();
    expect(payload.code).toBe("RATE_LIMITED");
    expect(typeof payload.retryAt).toBe("number");
  });

  test("quickSave maps rate limit contention errors to 429", async () => {
    const runMutation = mock().mockRejectedValueOnce(
      new Error(
        'Documents read from or written to the "rateLimits" table changed while this mutation was being run and on every subsequent retry.'
      )
    );

    const response = await runHandler(
      quickSave,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/api/raycast/quick-save", {
        method: "POST",
        headers: {
          Authorization: "Bearer teakapi_abc_secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(429);
    const payload = await response.json();
    expect(payload.code).toBe("RATE_LIMITED");
  });

  test("quickSave returns 500 when auth mutation throws unexpected error", async () => {
    const runMutation = mock().mockRejectedValueOnce(
      new Error("db unavailable")
    );

    const response = await runHandler(
      quickSave,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/api/raycast/quick-save", {
        method: "POST",
        headers: {
          Authorization: "Bearer teakapi_abc_secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: "INTERNAL_ERROR",
      error: "Failed to authorize request",
    });
  });

  test("quickSave returns 401 for invalid API key", async () => {
    const runMutation = mock()
      .mockResolvedValueOnce({ ok: true, retryAt: undefined })
      .mockResolvedValueOnce(null);

    const response = await runHandler(
      quickSave,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/api/raycast/quick-save", {
        method: "POST",
        headers: {
          Authorization: "Bearer teakapi_abc_secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.code).toBe("INVALID_API_KEY");
  });

  test("quickSave returns 400 for malformed JSON", async () => {
    const response = await runHandler(
      quickSave,
      { runMutation: buildAuthorizedMutationMock(), runQuery: mock() },
      new Request("https://example.com/api/raycast/quick-save", {
        method: "POST",
        headers: {
          Authorization: "Bearer teakapi_abc_secret",
          "Content-Type": "application/json",
        },
        body: "{invalid",
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("BAD_REQUEST");
  });

  test("quickSave returns 400 for empty content", async () => {
    const response = await runHandler(
      quickSave,
      { runMutation: buildAuthorizedMutationMock(), runQuery: mock() },
      new Request("https://example.com/api/raycast/quick-save", {
        method: "POST",
        headers: {
          Authorization: "Bearer teakapi_abc_secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "    " }),
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("INVALID_INPUT");
  });

  test("quickSave returns created payload", async () => {
    const runMutation = buildAuthorizedMutationMock().mockResolvedValueOnce({
      status: "created",
      cardId: "card_1",
    });

    const response = await runHandler(
      quickSave,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/api/raycast/quick-save", {
        method: "POST",
        headers: {
          Authorization: "Bearer teakapi_abc_secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "https://example.com" }),
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      appUrl: "https://app.teakvault.com/?card=card_1",
      cardId: "card_1",
      status: "created",
    });
  });

  test("quickSave maps ConvexError payload to stable code", async () => {
    const runMutation = buildAuthorizedMutationMock().mockRejectedValueOnce(
      new ConvexError({
        code: "INVALID_INPUT",
        message: "Content cannot be empty",
      })
    );

    const response = await runHandler(
      quickSave,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/api/raycast/quick-save", {
        method: "POST",
        headers: {
          Authorization: "Bearer teakapi_abc_secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toEqual({
      code: "INVALID_INPUT",
      error: "Content cannot be empty",
    });
  });

  test("searchCards returns mapped items", async () => {
    const runMutation = buildAuthorizedMutationMock();
    const runQuery = mock().mockResolvedValue([
      {
        _id: "card_1",
        type: "text",
        content: "Hello",
        notes: undefined,
        url: undefined,
        tags: ["tag"],
        aiTags: undefined,
        aiSummary: undefined,
        isFavorited: true,
        createdAt: 1,
        updatedAt: 2,
        fileUrl: undefined,
        thumbnailUrl: undefined,
        screenshotUrl: undefined,
        linkPreviewImageUrl: undefined,
        metadataTitle: undefined,
        metadataDescription: undefined,
      },
    ]);

    const response = await runHandler(
      searchCards,
      { runMutation, runQuery },
      new Request("https://example.com/api/raycast/search?q=hello&limit=50", {
        method: "GET",
        headers: {
          Authorization: "Bearer teakapi_abc_secret",
        },
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.total).toBe(1);
    expect(payload.items[0].id).toBe("card_1");
  });

  test("searchCards clamps invalid limit values", async () => {
    const runMutation = buildAuthorizedMutationMock();
    const runQuery = mock().mockResolvedValue([]);

    const response = await runHandler(
      searchCards,
      { runMutation, runQuery },
      new Request("https://example.com/api/raycast/search?limit=999", {
        method: "GET",
        headers: {
          Authorization: "Bearer teakapi_abc_secret",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runQuery.mock.calls[0][1].limit).toBe(100);
  });

  test("favoriteCards returns read-only list payload", async () => {
    const runMutation = buildAuthorizedMutationMock();
    const runQuery = mock().mockResolvedValue([]);

    const response = await runHandler(
      favoriteCards,
      { runMutation, runQuery },
      new Request("https://example.com/api/raycast/favorites", {
        method: "GET",
        headers: {
          Authorization: "Bearer teakapi_abc_secret",
        },
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ items: [], total: 0 });
  });

  test("favoriteCards returns 405 for non-GET methods", async () => {
    const response = await runHandler(
      favoriteCards,
      { runMutation: mock(), runQuery: mock() },
      new Request("https://example.com/api/raycast/favorites", {
        method: "POST",
      })
    );

    expect(response.status).toBe(405);
    const payload = await response.json();
    expect(payload.code).toBe("METHOD_NOT_ALLOWED");
  });

  test("createCardV1 uses quick-save contract", async () => {
    const runMutation = buildAuthorizedMutationMock().mockResolvedValueOnce({
      status: "created",
      cardId: "card_9",
    });

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization: "Bearer teakapi_abc_secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "new card" }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      appUrl: "https://app.teakvault.com/?card=card_9",
      cardId: "card_9",
      status: "created",
    });
  });

  test("searchCardsV1 returns items and total", async () => {
    const runMutation = buildAuthorizedMutationMock();
    const runQuery = mock().mockResolvedValue([]);

    const response = await runHandler(
      searchCardsV1,
      { runMutation, runQuery },
      new Request("https://example.com/v1/cards/search?limit=10", {
        method: "GET",
        headers: {
          Authorization: "Bearer teakapi_abc_secret",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], total: 0 });
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
          Authorization: "Bearer teakapi_abc_secret",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], total: 0 });
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
          Authorization: "Bearer teakapi_abc_secret",
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
          Authorization: "Bearer teakapi_abc_secret",
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
          Authorization: "Bearer teakapi_abc_secret",
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
          Authorization: "Bearer teakapi_abc_secret",
        },
      })
    );

    expect(response.status).toBe(204);
  });
});
