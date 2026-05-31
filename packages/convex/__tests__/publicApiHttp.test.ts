// @ts-nocheck

import { describe, expect, mock, test } from "bun:test";
import { ConvexError } from "convex/values";
import {
  bulkCardsV1,
  cardByIdV1,
  changesCardsV1,
  createCardV1,
  favoriteCardsV1,
  listCardsV1,
  searchCardsV1,
  tagsV1,
} from "../publicApiHttp";

const runHandler = async (fn: any, ctx: any, request: Request) => {
  const handler = (fn as any).handler ?? fn;
  return handler(ctx, request);
};

const buildAuthorizedMutationMock = () =>
  mock()
    // validateUserApiKey now runs first (effectively read-only on hot path)...
    .mockResolvedValueOnce({
      keyId: "key_1",
      userId: "user_1",
      access: "full_access",
    })
    // ...then the per-key rate limit check.
    .mockResolvedValueOnce({ ok: true, retryAt: undefined });

const buildAuthorizedMutationMockWithIdempotencySkip = () =>
  buildAuthorizedMutationMock().mockResolvedValueOnce(undefined);

describe("publicApiHttp", () => {
  test("createCardV1 returns 405 for non-POST methods", async () => {
    const response = await runHandler(
      createCardV1,
      { runMutation: mock(), runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "GET",
      })
    );

    expect(response.status).toBe(405);
    const payload = await response.json();
    expect(payload.code).toBe("METHOD_NOT_ALLOWED");
  });

  test("createCardV1 returns 401 without bearer token", async () => {
    const response = await runHandler(
      createCardV1,
      { runMutation: mock(), runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.code).toBe("UNAUTHORIZED");
  });

  test("createCardV1 returns 429 when rate limited", async () => {
    const runMutation = mock()
      // validate succeeds first...
      .mockResolvedValueOnce({
        keyId: "key_1",
        userId: "user_1",
        access: "full_access",
      })
      // ...then the per-key rate limit rejects.
      .mockResolvedValueOnce({
        ok: false,
        retryAt: Date.now() + 30_000,
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
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(429);
    const payload = await response.json();
    expect(payload.code).toBe("RATE_LIMITED");
    expect(typeof payload.retryAt).toBe("number");
  });

  test("createCardV1 maps rate limit contention errors to 429", async () => {
    const runMutation = mock()
      // validate succeeds first...
      .mockResolvedValueOnce({
        keyId: "key_1",
        userId: "user_1",
        access: "full_access",
      })
      // ...then the per-key rate limit hits document contention.
      .mockRejectedValueOnce(
        new Error(
          'Documents read from or written to the "rateLimits" table changed while this mutation was being run and on every subsequent retry.'
        )
      );

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
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

  test("createCardV1 returns 500 when auth mutation throws unexpected error", async () => {
    const runMutation = mock().mockRejectedValueOnce(
      new Error("db unavailable")
    );

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
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

  test("createCardV1 returns 401 without consuming a rate limit for malformed keys", async () => {
    // Malformed tokens must skip key validation entirely and only touch the
    // shared invalid-auth bucket, so exactly one mutation should run.
    const runMutation = mock().mockResolvedValueOnce({ ok: true });

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          // Missing the secret segment -> structurally invalid.
          Authorization: "Bearer teakapi_abc",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.code).toBe("INVALID_API_KEY");
    // Only the invalid-auth bucket consume runs; validation is never reached.
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  test("createCardV1 returns 429 when the shared invalid-auth bucket is exhausted", async () => {
    const runMutation = mock().mockResolvedValueOnce({
      ok: false,
      retryAt: Date.now() + 30_000,
    });

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization: "Bearer teakapi_zzz",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(429);
    const payload = await response.json();
    expect(payload.code).toBe("RATE_LIMITED");
  });

  test("createCardV1 returns 401 for invalid API key", async () => {
    const runMutation = mock()
      // validate rejects the (well-formed) key...
      .mockResolvedValueOnce(null)
      // ...and the shared invalid-auth bucket still has capacity.
      .mockResolvedValueOnce({ ok: true });

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
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

  test("createCardV1 returns 400 for malformed JSON", async () => {
    const response = await runHandler(
      createCardV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery: mock() },
      new Request("https://example.com/v1/cards", {
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

  test("createCardV1 returns 400 for empty content", async () => {
    const response = await runHandler(
      createCardV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery: mock() },
      new Request("https://example.com/v1/cards", {
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

  test("createCardV1 returns 400 for unsafe url scheme", async () => {
    const response = await runHandler(
      createCardV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization: "Bearer teakapi_abc_secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: "javascript:alert(1)" }),
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("INVALID_INPUT");
  });

  test("createCardV1 maps ConvexError payload to stable code", async () => {
    const runMutation =
      buildAuthorizedMutationMockWithIdempotencySkip().mockRejectedValueOnce(
        new ConvexError({
          code: "INVALID_INPUT",
          message: "Content cannot be empty",
        })
      );

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
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

  test("createCardV1 returns created payload", async () => {
    const runMutation =
      buildAuthorizedMutationMockWithIdempotencySkip().mockResolvedValueOnce({
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

  test("createCardV1 rejects requests whose idempotency key is already in progress", async () => {
    const runMutation = mock()
      // validate first...
      .mockResolvedValueOnce({
        access: "full_access",
        keyId: "key_1",
        userId: "user_1",
      })
      // ...then per-key rate limit...
      .mockResolvedValueOnce({ ok: true, retryAt: undefined })
      // ...then the idempotency reservation reports in-progress.
      .mockResolvedValueOnce({
        record: {
          _id: "idem_1",
          _creationTime: 1,
          createdAt: 1,
          expiresAt: Date.now() + 60_000,
          keyHash: "hash_1",
          method: "POST",
          path: "/v1/cards",
          requestHash: "request_hash",
          responseBody: null,
          responseStatus: 0,
          state: "pending",
          updatedAt: 1,
          userId: "user_1",
        },
        status: "in_progress",
      });

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization: "Bearer teakapi_abc_secret",
          "Content-Type": "application/json",
          "Idempotency-Key": "save-card-1",
        },
        body: JSON.stringify({ content: "new card" }),
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "CONFLICT",
      error: "Idempotency-Key is already being processed",
    });
    // validate + rateLimit + beginIdempotencyRequest + trackIdempotencyOutcome
    expect(runMutation).toHaveBeenCalledTimes(4);
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

  test("searchCardsV1 clamps invalid limit values", async () => {
    const runMutation = buildAuthorizedMutationMock();
    const runQuery = mock().mockResolvedValue([]);

    const response = await runHandler(
      searchCardsV1,
      { runMutation, runQuery },
      new Request("https://example.com/v1/cards/search?limit=999", {
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

  test("listCardsV1 returns paginated items with pageInfo", async () => {
    const runMutation = buildAuthorizedMutationMock();
    const runQuery = mock().mockResolvedValueOnce({
      items: [
        {
          _id: "card_1",
          type: "link",
          content: "Hello",
          url: "https://example.com",
          tags: ["design"],
          aiTags: ["ui"],
          isFavorited: true,
          createdAt: 1,
          updatedAt: 2,
          metadataTitle: "Example",
          metadataDescription: "Desc",
        },
      ],
      pageInfo: {
        hasMore: false,
        nextCursor: null,
      },
    });

    const response = await runHandler(
      listCardsV1,
      { runMutation, runQuery },
      new Request("https://example.com/v1/cards?limit=10&include=content", {
        method: "GET",
        headers: {
          Authorization: "Bearer teakapi_abc_secret",
        },
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.pageInfo).toEqual({ hasMore: false, nextCursor: null });
    expect(payload.items[0].content).toBe("Hello");
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
          Authorization: "Bearer teakapi_abc_secret",
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
          Authorization: "Bearer teakapi_abc_secret",
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
          Authorization: "Bearer teakapi_abc_secret",
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
          Authorization: "Bearer teakapi_abc_secret",
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
