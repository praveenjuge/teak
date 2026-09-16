// @ts-nocheck

import { describe, expect, mock, test } from "bun:test";
import { ConvexError } from "convex/values";
import {
  bulkCardsV1,
  cardByIdV1,
  changesCardsV1,
  createCardV1,
  listCardsV1,
} from "../publicApiHttp";
import {
  buildAuthorizedMutationMock,
  buildAuthorizedMutationMockWithIdempotencySkip,
  runHandler,
} from "./helpers/publicApiHttp.test-utils";

describe("publicApiHttp auth and validation", () => {
  test("cardByIdV1 validates the API key for the favorite route", async () => {
    const runMutation = mock()
      .mockResolvedValueOnce({
        keyId: "key_1",
        userId: "user_1",
        access: "full_access",
        source: "component",
        rateLimitKey: "component:key_1",
      })
      .mockResolvedValueOnce({
        ok: false,
        retryAt: Date.now() + 30_000,
      });

    const response = await runHandler(
      cardByIdV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards/card_123/favorite", {
        method: "PATCH",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ isFavorited: true }),
      })
    );

    expect(response.status).toBe(429);
    expect(runMutation.mock.calls[0][1]).toEqual({
      token:
        "teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    });
  });

  test("static card routes authorize with the bearer API key", async () => {
    const cases = [
      {
        handler: listCardsV1,
        method: "GET",
        path: "/v1/cards",
        query: mock().mockResolvedValue({
          itemCursors: [],
          items: [],
          nextCursor: null,
          scannedRows: 0,
        }),
      },
      {
        body: {
          items: [{ cardId: "card_1", isFavorited: true }],
          operation: "favorite",
        },
        handler: bulkCardsV1,
        method: "POST",
        mutation:
          buildAuthorizedMutationMockWithIdempotencySkip().mockResolvedValueOnce(
            {
              operation: "favorite",
              results: [{ cardId: "card_1", index: 0, status: "success" }],
              summary: { failed: 0, succeeded: 1, total: 1 },
            }
          ),
        path: "/v1/cards/bulk",
        query: mock(),
      },
      {
        handler: changesCardsV1,
        method: "GET",
        path: "/v1/cards/changes",
        queryString: "?since=1&limit=10",
        query: mock().mockResolvedValue({
          deletedIds: [],
          items: [],
          pageInfo: { hasMore: false, nextCursor: null },
        }),
      },
    ];

    for (const testCase of cases) {
      const runMutation = testCase.mutation ?? buildAuthorizedMutationMock();
      const response = await runHandler(
        testCase.handler,
        { runMutation, runQuery: testCase.query },
        new Request(
          `https://example.com${testCase.path}${
            testCase.queryString ?? "?limit=10"
          }`,
          {
            body: testCase.body ? JSON.stringify(testCase.body) : undefined,
            headers: {
              Authorization:
                "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
              ...(testCase.body ? { "Content-Type": "application/json" } : {}),
            },
            method: testCase.method,
          }
        )
      );

      expect(response.status).toBe(200);
      expect(runMutation.mock.calls[0][1]).toEqual({
        token:
          "teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      });
    }
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
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.code).toBe("INVALID_API_KEY");
  });

  test("listCardsV1 authorizes a valid OAuth access token", async () => {
    // 32-char alphabetic token -> OAuth-shaped, not API-key-shaped.
    const token = "a".repeat(32);
    const runMutation = mock()
      .mockResolvedValueOnce({
        access: "full_access",
        keyId: "oauth_token_1",
        rateLimitKey: "oauth:teak-desktop:user_1",
        source: "oauth",
        userId: "user_1",
      })
      .mockResolvedValueOnce({ ok: true, retryAt: undefined });
    const runQuery = mock().mockResolvedValue({
      itemCursors: [],
      items: [],
      nextCursor: null,
      scannedRows: 0,
    });

    const response = await runHandler(
      listCardsV1,
      { runMutation, runQuery },
      new Request("https://example.com/v1/cards?limit=10", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      })
    );

    expect(response.status).toBe(200);
    // OAuth validator receives only the token (no endpoint/method context).
    expect(runMutation.mock.calls[0][1]).toEqual({ token });
    // Rate limit is keyed on the stable OAuth identity, not the raw token.
    expect(runMutation.mock.calls[1][1]).toEqual({
      rateLimitKey: "key:oauth:teak-desktop:user_1",
    });
  });

  test("createCardV1 returns 401 UNAUTHORIZED for an invalid OAuth token", async () => {
    const token = "b".repeat(32);
    const runMutation = mock()
      // OAuth validation fails...
      .mockResolvedValueOnce(null)
      // ...and the shared invalid-auth bucket still has capacity.
      .mockResolvedValueOnce({ ok: true });

    const response = await runHandler(
      createCardV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "hello" }),
      })
    );

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.code).toBe("UNAUTHORIZED");
    expect(payload.error).toBe("Invalid or expired access token");
  });

  test("createCardV1 returns 400 for malformed JSON", async () => {
    const response = await runHandler(
      createCardV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery: mock() },
      new Request("https://example.com/v1/cards", {
        method: "POST",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
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
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
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
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
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
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
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
        source: "component",
        rateLimitKey: "component:key_1",
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
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
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
});
