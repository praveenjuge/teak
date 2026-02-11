// @ts-nocheck

import { describe, expect, mock, test } from "bun:test";
import { ConvexError } from "convex/values";
import { favoriteCards, quickSave, searchCards } from "../raycastHttp";

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
          Authorization: "Bearer teakrk_abc_secret",
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
          Authorization: "Bearer teakrk_abc_secret",
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
          Authorization: "Bearer teakrk_abc_secret",
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
          Authorization: "Bearer teakrk_abc_secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "    " }),
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("INVALID_INPUT");
  });

  test("quickSave returns duplicate/create payload", async () => {
    const runMutation = buildAuthorizedMutationMock().mockResolvedValueOnce({
      status: "duplicate",
      cardId: "card_1",
    });

    const response = await runHandler(
      quickSave,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/api/raycast/quick-save", {
        method: "POST",
        headers: {
          Authorization: "Bearer teakrk_abc_secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "https://example.com" }),
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ status: "duplicate", cardId: "card_1" });
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
          Authorization: "Bearer teakrk_abc_secret",
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
          Authorization: "Bearer teakrk_abc_secret",
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
          Authorization: "Bearer teakrk_abc_secret",
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
          Authorization: "Bearer teakrk_abc_secret",
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
});
