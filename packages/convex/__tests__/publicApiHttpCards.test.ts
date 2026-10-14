// @ts-nocheck

import { describe, expect, mock, test } from "bun:test";
import { ConvexError } from "convex/values";
import {
  bulkCardsV1,
  cardByIdV1,
  changesCardsV1,
  executePublicApiOperation,
  listCardsV1,
  tagsV1,
} from "../publicApiHttp";
import {
  buildAuthorizedMutationMock,
  buildAuthorizedMutationMockWithIdempotencySkip,
  runHandler,
} from "./helpers/publicApiHttp.test-utils";
import { withMappedOwner } from "./helpers/session.test-utils";

describe("publicApiHttp card endpoints", () => {
  test("removed search and favorites routes no longer serve card queries", async () => {
    const token = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;

    for (const path of ["/v1/cards/search", "/v1/cards/favorites"]) {
      const response = await executePublicApiOperation(
        withMappedOwner({
          runMutation: buildAuthorizedMutationMock(),
          runQuery: mock().mockResolvedValue(null),
        } as any),
        {
          method: "GET",
          path,
          query: { limit: 10 },
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      // The paths now fall through to the card-by-id handler, where the
      // trailing segment reads as an unknown card id.
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
    }
  });

  test.each([true, false])(
    "dispatches restore for a card with deleted=%s",
    async (isDeleted) => {
      const response = await executePublicApiOperation(
        withMappedOwner({
          runMutation:
            buildAuthorizedMutationMock().mockResolvedValueOnce(null),
          runQuery: mock()
            .mockResolvedValueOnce("card_1")
            .mockResolvedValueOnce({
              _id: "card_1",
              userId: "user_1",
              isDeleted,
            }),
        }),
        {
          method: "POST",
          path: "/v1/cards/card_1/restore",
          headers: {
            Authorization: `Bearer teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`,
          },
        }
      );
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
    }
  );

  test("listCardsV1 reports an over-broad search as invalid input", async () => {
    const message =
      "Search is too broad. Add a type, favorite, or date filter.";
    const response = await runHandler(
      listCardsV1,
      {
        runMutation: buildAuthorizedMutationMock(),
        runQuery: mock().mockRejectedValue(
          new ConvexError({
            code: "INVALID_INPUT",
            message,
          })
        ),
      },
      new Request("https://example.com/v1/cards?q=design", {
        headers: {
          Authorization: `Bearer teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`,
        },
      })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "INVALID_INPUT",
      error: message,
    });
  });

  test("listCardsV1 rejects partial numeric createdAfter values", async () => {
    const runMutation = buildAuthorizedMutationMock();

    const response = await runHandler(
      listCardsV1,
      { runMutation, runQuery: mock() },
      new Request("https://example.com/v1/cards?createdAfter=10junk", {
        method: "GET",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("INVALID_INPUT");
  });

  test("listCardsV1 forwards repeated types and exposes selected display fields", async () => {
    const runQuery = mock().mockResolvedValue({
      itemCursors: ["after-card-1"],
      items: [
        {
          _id: "card_1",
          type: "link",
          content: "https://example.com",
          createdAt: 1,
          updatedAt: 2,
          storageKey: "private-object-key",
          colors: [{ hex: "#112233", name: "Ink", rgb: { r: 1, g: 2, b: 3 } }],
          aiTranscript: "Transcript",
          linkPreviewMedia: [
            { type: "image", url: "https://files.example.com/signed" },
          ],
          metadata: {
            linkPreview: {
              siteName: "Example",
              author: "Author",
              raw: { secret: "hidden" },
            },
          },
        },
      ],
      nextCursor: null,
      scannedRows: 1,
    });
    const response = await runHandler(
      listCardsV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery },
      new Request(
        "https://example.com/v1/cards?type=image&type=link&include=content,metadata,processing",
        {
          headers: {
            Authorization:
              "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          },
        }
      )
    );
    expect(response.status).toBe(200);
    expect(runQuery.mock.calls[0]?.[1]).toMatchObject({
      types: ["image", "link"],
      type: undefined,
    });
    const item = (await response.json()).items[0];
    expect(item.colors).toEqual([{ hex: "#112233", name: "Ink" }]);
    expect(item.aiTranscript).toBe("Transcript");
    expect(item.linkPreviewMedia).toEqual([
      { type: "image", url: "https://files.example.com/signed" },
    ]);
    expect(item.linkSiteName).toBe("Example");
    expect(item.linkAuthor).toBe("Author");
    expect(JSON.stringify(item)).not.toContain("secret");
    expect(JSON.stringify(item)).not.toContain("storageKey");
  });

  const authorized = (url: string) =>
    new Request(url, {
      headers: {
        Authorization: `Bearer teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`,
      },
    });

  test("listCardsV1 reads qualifiers in q and merges them with the parameters", async () => {
    const runQuery = mock().mockResolvedValue({
      items: [],
      pageInfo: { hasMore: false, nextCursor: null },
    });
    const q = encodeURIComponent(
      'tag:design type:link site:www.GitHub.com "design system" #ui folder:"Reading list" is:fav'
    );
    const response = await runHandler(
      listCardsV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery },
      authorized(
        `https://example.com/v1/cards?q=${q}&tag=Brand&type=link&type=image`
      )
    );
    expect(response.status).toBe(200);
    // The text and the first tag route the search; the rest filter it.
    expect(runQuery.mock.calls[0]?.[1]).toMatchObject({
      searchQuery: "design system",
      tag: "brand",
      tags: ["design", "ui"],
      type: "link",
      types: undefined,
      sites: ["github.com"],
      phrases: ["design system"],
      folderNames: ["reading list"],
      favorited: true,
      archivedInTrash: false,
    });
  });

  test("listCardsV1 scans when q holds only qualifiers without text or tags", async () => {
    const runQuery = mock().mockResolvedValue({
      itemCursors: [],
      items: [],
      nextCursor: null,
      scannedRows: 0,
    });
    const response = await runHandler(
      listCardsV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery },
      authorized(
        `https://example.com/v1/cards?q=${encodeURIComponent("site:example.com is:archived")}`
      )
    );
    expect(response.status).toBe(200);
    expect(runQuery.mock.calls[0]?.[1]).toMatchObject({
      archived: "only",
      sites: ["example.com"],
      scanLimit: expect.any(Number),
    });
    expect(runQuery.mock.calls[0]?.[1].searchQuery).toBeUndefined();
  });

  test.each([
    ["type:text", "type=link"],
    ["is:archived", "archived=exclude"],
  ])("listCardsV1 answers %s with %s with no cards", async (q, param) => {
    const runQuery = mock();
    const response = await runHandler(
      listCardsV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery },
      authorized(
        `https://example.com/v1/cards?q=${encodeURIComponent(q)}&${param}`
      )
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      items: [],
      pageInfo: { hasMore: false, nextCursor: null },
    });
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("listCardsV1 answers an unknown folder with 404 even when q contradicts the other filters", async () => {
    const runQuery = mock().mockResolvedValue(null);
    const response = await runHandler(
      listCardsV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery },
      authorized(
        "https://example.com/v1/cards?folder=missing&type=link&q=type:text"
      )
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  test("listCardsV1 keeps is:archived in Trash to the archived cards", async () => {
    const runQuery = mock().mockResolvedValue({
      itemCursors: [],
      items: [],
      nextCursor: null,
      scannedRows: 0,
    });
    await runHandler(
      listCardsV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery },
      authorized("https://example.com/v1/cards?q=is:archived&trashed=true")
    );
    expect(runQuery.mock.calls[0]?.[1]).toMatchObject({
      showTrashOnly: true,
      archivedInTrash: true,
    });
    expect(runQuery.mock.calls[0]?.[1].archived).toBeUndefined();
  });

  test("listCardsV1 rejects any invalid repeated type", async () => {
    const response = await runHandler(
      listCardsV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery: mock() },
      new Request("https://example.com/v1/cards?type=image&type=invalid", {
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      })
    );
    expect(response.status).toBe(400);
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

  test("bulkCardsV1 runs the archive operations and reports failedIds", async () => {
    const result = {
      operation: "archive",
      results: [
        { index: 0, status: "success", cardId: "card_1" },
        {
          index: 1,
          status: "error",
          code: "NOT_FOUND",
          error: "Card not found",
        },
      ],
      failedIds: ["card_2"],
      summary: { total: 2, succeeded: 1, failed: 1 },
    };
    const runMutation =
      buildAuthorizedMutationMockWithIdempotencySkip().mockResolvedValueOnce(
        result
      );

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
          operation: "archive",
          items: [{ cardId: "card_1" }, { cardId: "card_2" }],
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
  });

  test("bulkCardsV1 rejects an unknown operation", async () => {
    const runMutation = buildAuthorizedMutationMockWithIdempotencySkip();
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
        body: JSON.stringify({ operation: "shred", items: [{ cardId: "c" }] }),
      })
    );
    expect(response.status).toBe(400);
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
    expect(runMutation).toHaveBeenCalledTimes(1);
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
    expect(runMutation).toHaveBeenCalledTimes(1);
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
    const runQuery = mock().mockResolvedValueOnce({
      items: [{ name: "design", count: 3 }],
      isComplete: true,
    });

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
      isComplete: true,
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

  test("cardByIdV1 returns native display fields without internal metadata", async () => {
    const runQuery = mock()
      .mockResolvedValueOnce("card_1")
      .mockResolvedValueOnce({
        _id: "card_1",
        type: "link",
        content: "https://example.com",
        createdAt: 1,
        updatedAt: 2,
        colors: [{ hex: "#112233", hsl: { h: 1, s: 2, l: 3 } }],
        aiTranscript: "A transcript",
        linkPreviewMedia: [
          { type: "video", url: "https://files.example.com/signed-video" },
        ],
        metadata: {
          linkPreview: {
            siteName: "Example",
            publishedAt: "2026-09-23",
            raw: { token: "secret" },
          },
        },
      });
    const response = await runHandler(
      cardByIdV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery },
      new Request("https://example.com/v1/cards/card_1", {
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      })
    );
    expect(response.status).toBe(200);
    const card = await response.json();
    expect(card.colors).toEqual([{ hex: "#112233" }]);
    expect(card.aiTranscript).toBe("A transcript");
    expect(card.linkPreviewMedia).toEqual([
      { type: "video", url: "https://files.example.com/signed-video" },
    ]);
    expect(card.linkSiteName).toBe("Example");
    expect(card.linkPublishedAt).toBe("2026-09-23");
    expect(JSON.stringify(card)).not.toContain("secret");
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
      metadataTitle: "Edited title",
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
        body: JSON.stringify({
          notes: null,
          tags: [],
          metadataTitle: "Edited title",
        }),
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.id).toBe("card_1");
    expect(payload.notes).toBeNull();
    expect(payload.tags).toEqual([]);
    expect(payload.metadataTitle).toBe("Edited title");
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      cardId: "card_1",
      userId: "user_1",
      notes: null,
      tags: [],
      metadataTitle: "Edited title",
    });
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
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({ content });
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
    expect(runMutation).toHaveBeenCalledTimes(1);
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

  test.each([
    ["POST", "/restore"],
    ["DELETE", "?permanent=true"],
  ])(
    "%s allows Trash lifecycle operation %s",
    async (method: string, suffix: string) => {
      const response = await runHandler(
        cardByIdV1,
        {
          runMutation:
            buildAuthorizedMutationMock().mockResolvedValueOnce(null),
          runQuery: mock()
            .mockResolvedValueOnce("card_1")
            .mockResolvedValueOnce({
              _id: "card_1",
              userId: "user_1",
              isDeleted: true,
            }),
        },
        new Request(`https://example.com/v1/cards/card_1${suffix}`, {
          method,
          headers: {
            Authorization:
              "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          },
        })
      );
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
    }
  );

  describe("GET /v1/cards/:id/content", () => {
    const contentRequest = () =>
      new Request("https://example.com/v1/cards/card_1/content", {
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      });
    const fullText = "Kestrel Freight agreed to net 30 days on every invoice.";
    const sha256 = async (text: string) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
        ),
        (byte) => byte.toString(16).padStart(2, "0")
      ).join("");
    const respond = (source: unknown, card: unknown = { _id: "card_1" }) =>
      runHandler(
        cardByIdV1,
        {
          runMutation: buildAuthorizedMutationMock(),
          runQuery: mock()
            .mockResolvedValueOnce("card_1")
            .mockResolvedValueOnce(card && { userId: "user_1", ...card })
            .mockResolvedValueOnce(source),
        },
        contentRequest()
      );
    const withStoredText = async (
      body: string,
      run: (key: string) => Promise<void>
    ) => {
      const originalFetch = global.fetch;
      const originalBase = process.env.FILES_BASE;
      const originalSecret = process.env.FILES_SIGNING_SECRET;
      process.env.FILES_BASE = "https://files.test";
      process.env.FILES_SIGNING_SECRET = "test-secret";
      const key = `users/u1/cards/card1/document-text/${await sha256(fullText)}.txt`;
      global.fetch = mock((url: string) => {
        expect(new URL(url).pathname).toBe(`/${key}`);
        return Promise.resolve(new Response(body));
      }) as any;
      try {
        await run(key);
      } finally {
        global.fetch = originalFetch;
        process.env.FILES_BASE = originalBase;
        process.env.FILES_SIGNING_SECRET = originalSecret;
      }
    };

    test("returns the full document text read from storage", async () => {
      await withStoredText(fullText, async (key) => {
        const response = await respond({
          cardId: "card_1",
          kind: "document",
          text: "Kestrel Freight",
          sourceKey: key,
          charCount: fullText.length,
          truncated: false,
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          cardId: "card_1",
          kind: "document",
          text: fullText,
          charCount: fullText.length,
          truncated: false,
        });
      });
    });

    test("falls back to the searchable prefix, marked truncated, when storage disagrees", async () => {
      await withStoredText("tampered text", async (key) => {
        const response = await respond({
          cardId: "card_1",
          kind: "document",
          text: "Kestrel Freight",
          sourceKey: key,
          charCount: fullText.length,
          truncated: false,
        });
        expect(await response.json()).toMatchObject({
          text: "Kestrel Freight",
          truncated: true,
        });
      });
    });

    test("a transcript or written content comes from the card itself", async () => {
      const response = await respond({
        cardId: "card_1",
        kind: "transcript",
        text: "Hello from the clip",
        charCount: 19,
        truncated: false,
      });
      expect(await response.json()).toEqual({
        cardId: "card_1",
        kind: "transcript",
        text: "Hello from the clip",
        charCount: 19,
        truncated: false,
      });
    });

    test("NO_CONTENT for a card without text; NOT_FOUND for another user's card", async () => {
      const empty = await respond(null);
      expect(empty.status).toBe(404);
      expect(await empty.json()).toMatchObject({ code: "NO_CONTENT" });

      const stranger = await respond(null, null);
      expect(stranger.status).toBe(404);
      expect(await stranger.json()).toMatchObject({ code: "NOT_FOUND" });
    });
  });

  const refreshRequest = (cardId = "card_1") =>
    new Request(`https://example.com/v1/cards/${cardId}/refresh`, {
      method: "POST",
      headers: {
        Authorization:
          "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      },
    });

  test("refresh answers 202 with the queued card", async () => {
    const response = await runHandler(
      cardByIdV1,
      {
        runMutation: buildAuthorizedMutationMock().mockResolvedValueOnce({
          cardId: "card_1",
          requestedAt: 1_700_000_000_000,
        }),
        runQuery: mock()
          .mockResolvedValueOnce("card_1")
          .mockResolvedValueOnce({ _id: "card_1", userId: "user_1" }),
      },
      refreshRequest()
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      cardId: "card_1",
      requestedAt: 1_700_000_000_000,
      status: "queued",
    });
  });

  test("refresh maps the rate limit to 429 with retryAt and Retry-After", async () => {
    const retryAt = Date.now() + 30_000;
    const response = await runHandler(
      cardByIdV1,
      {
        runMutation: buildAuthorizedMutationMock().mockRejectedValueOnce(
          new ConvexError({
            code: "RATE_LIMITED",
            message: "This card is already refreshing. Try again in a minute.",
            limit: 1,
            retryAt,
          })
        ),
        runQuery: mock()
          .mockResolvedValueOnce("card_1")
          .mockResolvedValueOnce({ _id: "card_1", userId: "user_1" }),
      },
      refreshRequest()
    );
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await response.json()).toMatchObject({
      code: "RATE_LIMITED",
      error: "This card is already refreshing. Try again in a minute.",
      retryAt,
    });
  });

  test("refresh of a card in Trash answers 409", async () => {
    const response = await runHandler(
      cardByIdV1,
      {
        runMutation: buildAuthorizedMutationMock().mockRejectedValueOnce(
          new ConvexError({
            code: "CONFLICT",
            message: "Restore this card from Trash before refreshing it",
          })
        ),
        runQuery: mock().mockResolvedValueOnce("card_1").mockResolvedValueOnce({
          _id: "card_1",
          userId: "user_1",
          isDeleted: true,
        }),
      },
      refreshRequest()
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "CONFLICT",
      error: "Restore this card from Trash before refreshing it",
    });
  });

  test("refresh of an unknown card answers 404 without queueing", async () => {
    const runMutation = buildAuthorizedMutationMock();
    const response = await runHandler(
      cardByIdV1,
      { runMutation, runQuery: mock().mockResolvedValueOnce(null) },
      refreshRequest("missing")
    );
    expect(response.status).toBe(404);
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  test("refresh is reachable through executePublicApiOperation", async () => {
    const response = await executePublicApiOperation(
      withMappedOwner({
        runMutation: buildAuthorizedMutationMock().mockResolvedValueOnce({
          cardId: "card_1",
          requestedAt: 1,
        }),
        runQuery: mock()
          .mockResolvedValueOnce("card_1")
          .mockResolvedValueOnce({ _id: "card_1", userId: "user_1" }),
      }),
      {
        method: "POST",
        path: "/v1/cards/card_1/refresh",
        headers: {
          Authorization: `Bearer teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`,
        },
      }
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "queued" });
  });

  test("a permanent delete of an active card asks to trash it first", async () => {
    const runMutation = buildAuthorizedMutationMock();
    const response = await runHandler(
      cardByIdV1,
      {
        runMutation,
        runQuery: mock()
          .mockResolvedValueOnce("card_1")
          .mockResolvedValueOnce({ _id: "card_1", userId: "user_1" }),
      },
      new Request("https://example.com/v1/cards/card_1?permanent=true", {
        method: "DELETE",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      })
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "NOT_IN_TRASH",
      error: "Move the card to Trash before deleting it permanently",
    });
    // Only the auth call ran; nothing was deleted.
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  test("a backend NOT_IN_TRASH race also answers 409", async () => {
    const response = await runHandler(
      cardByIdV1,
      {
        runMutation: buildAuthorizedMutationMock().mockRejectedValueOnce(
          new ConvexError({
            code: "NOT_IN_TRASH",
            message: "Move the card to Trash before deleting it permanently",
          })
        ),
        runQuery: mock().mockResolvedValueOnce("card_1").mockResolvedValueOnce({
          _id: "card_1",
          userId: "user_1",
          isDeleted: true,
        }),
      },
      new Request("https://example.com/v1/cards/card_1?permanent=true", {
        method: "DELETE",
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      })
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "NOT_IN_TRASH" });
  });

  test.each([
    [
      "top-level",
      { operation: "delete", permanent: true, items: [{ cardId: "c" }] },
    ],
    [
      "per-item",
      { operation: "delete", items: [{ cardId: "c", permanent: true }] },
    ],
  ])("bulk delete rejects a %s permanent flag", async (_label, body) => {
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
        body: JSON.stringify(body),
      })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_INPUT" });
    expect(runMutation).toHaveBeenCalledTimes(1);
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
    expect(runMutation).toHaveBeenCalledTimes(1);
  });
});
