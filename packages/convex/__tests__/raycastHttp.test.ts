// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import { favoriteCards, quickSave, searchCards } from "../raycastHttp";

const runHandler = async (fn: any, ctx: any, request: Request) => {
  const handler = (fn as any).handler ?? fn;
  return handler(ctx, request);
};

describe("raycastHttp", () => {
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
  });

  test("quickSave returns duplicate/create payload", async () => {
    const runMutation = mock()
      .mockResolvedValueOnce({
        keyId: "key_1",
        userId: "user_1",
        access: "full_access",
      })
      .mockResolvedValueOnce({ status: "duplicate", cardId: "card_1" });

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

  test("searchCards returns mapped items", async () => {
    const runMutation = mock().mockResolvedValue({
      keyId: "key_1",
      userId: "user_1",
      access: "full_access",
    });
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

  test("favoriteCards returns read-only list payload", async () => {
    const runMutation = mock().mockResolvedValue({
      keyId: "key_1",
      userId: "user_1",
      access: "full_access",
    });
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
});
