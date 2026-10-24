import { describe, expect, mock, spyOn, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import {
  bulkCardsV1,
  cardByIdV1,
  changesCardsV1,
  executePublicApiOperation,
  listCardsV1,
  tagsV1,
} from "../../../publicApi/http/routes";
import { serializeCard } from "../../../publicApi/http/serializers";
import { mockActionCtx } from "../../helpers/convex.test-utils";
import {
  buildAuthorizedMutationMock,
  buildAuthorizedMutationMockWithIdempotencySkip,
  runHandler,
} from "../../helpers/publicApiHttp.test-utils";
import { withMappedOwner } from "../../helpers/session.test-utils";

describe("publicApiHttp card endpoints", () => {
  test("removed search and favorites routes no longer serve card queries", async () => {
    const token = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;

    for (const path of ["/v1/cards/search", "/v1/cards/favorites"]) {
      const response = await executePublicApiOperation(
        mockActionCtx(
          withMappedOwner({
            runMutation: buildAuthorizedMutationMock(),
            runQuery: mock().mockResolvedValue(null),
          } as any)
        ),
        {
          method: "GET",
          path,
          query: { limit: 10 },
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
    }
  });

  test.each([true, false])(
    "dispatches restore for a card with deleted=%s",
    async (isDeleted) => {
      const response = await executePublicApiOperation(
        mockActionCtx(
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
          })
        ),
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
          aiOcrText: "STOP",
          linkPreviewMedia: [
            { type: "image", url: "https://files.example.com/signed" },
          ],
          metadata: {
            linkPreview: {
              siteName: "Example",
              author: "Author",
              raw: { secret: "hidden" },
            },
            linkCategory: {
              category: "product",
              fetchedAt: 1,
              sourceUrl: "https://example.com",
              price: { amount: 24.99, currency: "USD" },
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
    expect(item).not.toHaveProperty("aiOcrText");
    expect(item.linkPreviewMedia).toEqual([
      { type: "image", url: "https://files.example.com/signed" },
    ]);
    expect(item.linkSiteName).toBe("Example");
    expect(item.linkAuthor).toBe("Author");
    expect(item.linkPrice).toEqual({ amount: 24.99, currency: "USD" });
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

  test("listCardsV1 marks hidden cards and passes a reserved tag in q on", async () => {
    const runQuery = mock().mockResolvedValue({
      items: [
        {
          _id: "card_1",
          type: "text",
          content: "Hidden note",
          tags: ["Secret"],
          createdAt: 1,
          updatedAt: 1,
        },
        {
          _id: "card_2",
          type: "text",
          content: "AI-tagged only",
          tags: ["work"],
          aiTags: ["hidden"],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      pageInfo: { hasMore: false, nextCursor: null },
    });
    const response = await runHandler(
      listCardsV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery },
      authorized(
        `https://example.com/v1/cards?q=${encodeURIComponent("#Secret")}`
      )
    );
    expect(response.status).toBe(200);
    expect(runQuery.mock.calls[0]?.[1]).toMatchObject({ tag: "secret" });
    const payload = await response.json();
    expect(
      payload.items.map((item: { isHidden: boolean }) => item.isHidden)
    ).toEqual([true, false]);
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

  test("listCardsV1 reads price: bounds in q and narrows to links", async () => {
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
        `https://example.com/v1/cards?q=${encodeURIComponent("price:>20 price:<=100")}`
      )
    );
    expect(response.status).toBe(200);
    expect(runQuery.mock.calls[0]?.[1]).toMatchObject({
      type: "link",
      prices: [
        { op: ">", amount: 20 },
        { op: "<=", amount: 100 },
      ],
      scanLimit: expect.any(Number),
    });
    expect(runQuery.mock.calls[0]?.[1].searchQuery).toBeUndefined();
  });

  test("listCardsV1 searches image text for text: in q", async () => {
    const runQuery = mock().mockResolvedValue({
      items: [],
      pageInfo: { hasMore: false, nextCursor: null },
    });
    const response = await runHandler(
      listCardsV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery },
      authorized(
        `https://example.com/v1/cards?mode=keyword&q=${encodeURIComponent('text:"Total due" text:4411')}`
      )
    );
    expect(response.status).toBe(200);
    expect(runQuery.mock.calls[0]?.[1]).toMatchObject({
      ocrTexts: ["Total due", "4411"],
    });
    expect(runQuery.mock.calls[0]?.[1].searchQuery).toBeUndefined();
    expect(runQuery.mock.calls[0]?.[1].scanLimit).toBeUndefined();
  });

  test.each([
    ["is:todo", { todo: true }],
    ["is:done", { done: true }],
  ])(
    "listCardsV1 reads %s in q as links filtered by done state",
    async (q, filter) => {
      const runQuery = mock().mockResolvedValue({
        items: [],
        pageInfo: { hasMore: false, nextCursor: null },
        itemCursors: [],
        nextCursor: null,
        scannedRows: 0,
      });
      const response = await runHandler(
        listCardsV1,
        { runMutation: buildAuthorizedMutationMock(), runQuery },
        authorized(`https://example.com/v1/cards?q=${encodeURIComponent(q)}`)
      );
      expect(response.status).toBe(200);
      expect(runQuery.mock.calls[0]?.[1]).toMatchObject({
        type: "link",
        ...filter,
      });
    }
  );

  test("listCardsV1 searches the words beside a price: bound", async () => {
    const runQuery = mock().mockResolvedValue({
      items: [],
      pageInfo: { hasMore: false, nextCursor: null },
    });
    await runHandler(
      listCardsV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery },
      authorized(
        `https://example.com/v1/cards?mode=keyword&q=${encodeURIComponent("desk lamp price:<50")}`
      )
    );
    expect(runQuery.mock.calls[0]?.[1]).toMatchObject({
      searchQuery: "desk lamp",
      type: "link",
      prices: [{ op: "<", amount: 50 }],
    });
  });

  test.each([
    ["type:text", "type=link"],
    ["is:archived", "archived=exclude"],
    ["price:<50", "type=image"],
    ["price:<50 type:text", "limit=5"],
    ["is:done is:todo", "limit=5"],
    ["is:todo", "type=image"],
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

  test("cardByIdV1 GET adds the card's links and backlinks", async () => {
    const links = {
      backlinks: [{ id: "card_3", missing: false, title: "C", type: "text" }],
      backlinksTruncated: false,
      links: [{ id: "card_2", missing: true, title: null, type: null }],
      linksTruncated: true,
    };
    const runQuery = mock()
      .mockResolvedValueOnce("card_1")
      .mockResolvedValueOnce({
        _id: "card_1",
        content: "See [[B|teak:card_2]]",
        createdAt: 1,
        type: "text",
        updatedAt: 2,
        userId: "user_1",
      })
      .mockResolvedValueOnce(links);
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
    expect(await response.json()).toMatchObject({ id: "card_1", ...links });
    expect(getFunctionName(runQuery.mock.calls[2]?.[0])).toBe(
      "card/cardLinks:getCardLinksForUser"
    );
  });

  test("cardByIdV1 PATCH returns the edited card with its links", async () => {
    const links = {
      backlinks: [],
      backlinksTruncated: false,
      links: [{ id: "card_2", missing: false, title: "B", type: "text" }],
      linksTruncated: false,
    };
    const runMutation = buildAuthorizedMutationMock().mockResolvedValueOnce({
      _id: "card_1",
      aiTags: [],
      content: "See [[B|teak:card_2]]",
      createdAt: 1,
      isFavorited: false,
      tags: [],
      type: "text",
      updatedAt: 2,
    });
    const runQuery = mock()
      .mockResolvedValueOnce("card_1")
      .mockResolvedValueOnce({ _id: "card_1", userId: "user_1" })
      .mockResolvedValueOnce(links);
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
        body: JSON.stringify({ content: "See [[B|teak:card_2]]" }),
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "card_1", ...links });
    expect(getFunctionName(runQuery.mock.calls[2]?.[0])).toBe(
      "card/cardLinks:getCardLinksForUser"
    );
  });

  test("cardByIdV1 GET still returns the card when its links can't load", async () => {
    const runQuery = mock()
      .mockResolvedValueOnce("card_1")
      .mockResolvedValueOnce({
        _id: "card_1",
        content: "See [[B|teak:card_2]]",
        createdAt: 1,
        type: "text",
        updatedAt: 2,
        userId: "user_1",
      })
      .mockRejectedValueOnce(new Error("timed out"));
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    let response: Response;
    try {
      response = await runHandler(
        cardByIdV1,
        { runMutation: buildAuthorizedMutationMock(), runQuery },
        new Request("https://example.com/v1/cards/card_1", {
          headers: {
            Authorization:
              "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          },
        })
      );
    } finally {
      warn.mockRestore();
    }
    expect(response.status).toBe(200);
    const card = await response.json();
    expect(card.id).toBe("card_1");
    expect(card).not.toHaveProperty("links");
    expect(card).not.toHaveProperty("backlinks");
  });

  test("changesCardsV1 leaves links and backlinks out of each item", async () => {
    const runQuery = mock().mockResolvedValueOnce({
      deletedIds: [],
      items: [
        {
          _id: "card_1",
          content: "See [[B|teak:card_2]]",
          createdAt: 1,
          type: "text",
          updatedAt: 2,
        },
      ],
      pageInfo: { hasMore: false, nextCursor: null },
    });
    const response = await runHandler(
      changesCardsV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery },
      new Request("https://example.com/v1/cards/changes?since=1&limit=10", {
        headers: {
          Authorization:
            "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      })
    );
    const [item] = (await response.json()).items;
    expect(item.id).toBe("card_1");
    expect(item).not.toHaveProperty("links");
    expect(item).not.toHaveProperty("backlinks");
    expect(runQuery).toHaveBeenCalledTimes(1);
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
        aiOcrText: "Invoice 4411",
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
    expect(card).not.toHaveProperty("aiOcrText");
    expect(card.linkPreviewMedia).toEqual([
      { type: "video", url: "https://files.example.com/signed-video" },
    ]);
    expect(card.linkSiteName).toBe("Example");
    expect(card.linkPublishedAt).toBe("2026-09-23");
    expect(card.linkPrice).toBeNull();
    expect(JSON.stringify(card)).not.toContain("secret");
  });

  test("cardByIdV1 returns a hidden card with isHidden", async () => {
    const runQuery = mock()
      .mockResolvedValueOnce("card_1")
      .mockResolvedValueOnce({
        _id: "card_1",
        type: "text",
        content: "Hidden note",
        tags: ["hidden"],
        isHidden: true,
        createdAt: 1,
        updatedAt: 2,
      });
    const response = await runHandler(
      cardByIdV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery },
      authorized("https://example.com/v1/cards/card_1")
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      content: "Hidden note",
      isHidden: true,
    });
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
    const contentRequest = (query = "") =>
      new Request(`https://example.com/v1/cards/card_1/content${query}`, {
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
    let runQuery = mock();
    const respond = (
      source: unknown,
      card: unknown = { _id: "card_1" },
      query = ""
    ) => {
      runQuery = mock()
        .mockResolvedValueOnce("card_1")
        .mockResolvedValueOnce(card && { userId: "user_1", ...card })
        .mockResolvedValueOnce(source);
      return runHandler(
        cardByIdV1,
        { runMutation: buildAuthorizedMutationMock(), runQuery },
        contentRequest(query)
      );
    };
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

    test("a fallback prefix that holds all of a short document's text is not truncated", async () => {
      await withStoredText("tampered text", async (key) => {
        const response = await respond({
          cardId: "card_1",
          kind: "document",
          text: fullText,
          sourceKey: key,
          charCount: fullText.length,
          truncated: false,
        });
        expect(await response.json()).toMatchObject({
          text: fullText,
          truncated: false,
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

    test("?kind=article returns the article's Markdown with each image as a signed URL", async () => {
      const markdown =
        '## Gardens\n\n![A rose](teak-image:0 "Spring")\n\n![](teak-image:7)';
      const originalFetch = global.fetch;
      const originalBase = process.env.FILES_BASE;
      const originalSecret = process.env.FILES_SIGNING_SECRET;
      process.env.FILES_BASE = "https://files.test";
      process.env.FILES_SIGNING_SECRET = "test-secret";
      const key = `users/u1/cards/card1/article-text/r1-${await sha256(markdown)}.md`;
      const imageKey = "users/u1/cards/card1/article-image/rose.webp";
      global.fetch = mock(() => Promise.resolve(new Response(markdown))) as any;
      try {
        const response = await respond(
          {
            cardId: "card_1",
            kind: "article",
            text: "Gardens",
            sourceKey: key,
            imageKeys: [imageKey],
            charCount: 7,
            truncated: false,
          },
          undefined,
          "?kind=article"
        );
        expect(runQuery.mock.calls[2]?.[1]).toEqual({
          cardId: "card_1",
          userId: "user_1",
          kind: "article",
        });
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toMatchObject({ kind: "article", charCount: 7 });
        const signed = /!\[A rose\]\((\S+) "Spring"\)/u.exec(body.text)?.[1];
        expect(new URL(signed ?? "").origin).toBe("https://files.test");
        expect(new URL(signed ?? "").pathname).toBe(`/${imageKey}`);
        expect(new URL(signed ?? "").searchParams.get("sig")).toBeTruthy();
        // A reference with no image left is dropped, never sent as a token.
        expect(body.text).not.toContain("teak-image:");
      } finally {
        global.fetch = originalFetch;
        process.env.FILES_BASE = originalBase;
        process.env.FILES_SIGNING_SECRET = originalSecret;
      }
    });

    test("?kind= asks for that kind only, 404 when the card has none of it", async () => {
      const response = await respond(null, undefined, "?kind=transcript");
      expect(runQuery.mock.calls[2]?.[1]).toMatchObject({ kind: "transcript" });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        code: "NO_CONTENT",
        error: "This card has no stored text of kind `transcript`",
      });
    });

    test("an unknown kind is a 400 before any read", async () => {
      const response = await respond(null, undefined, "?kind=slides");
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_INPUT" });
      expect(runQuery.mock.calls).toHaveLength(2);
    });

    test("without kind the query asks for no kind, so an article never comes back", async () => {
      await respond(null);
      expect(runQuery.mock.calls[2]?.[1]).toEqual({
        cardId: "card_1",
        userId: "user_1",
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

  const doneRequest = (method: "POST" | "DELETE") =>
    new Request("https://example.com/v1/cards/card_1/done", {
      method,
      headers: {
        Authorization:
          "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      },
    });
  const linkCard = {
    _id: "card_1",
    userId: "user_1",
    type: "link",
    content: "https://example.com",
    url: "https://example.com",
    createdAt: 1,
    updatedAt: 1,
    metadata: {
      linkCategory: {
        category: "movie",
        fetchedAt: 1,
        sourceUrl: "https://example.com",
      },
    },
  };

  test.each([
    ["POST", true, 1_700_000_000_000],
    ["DELETE", false, null],
  ] as const)(
    "%s /done sets done to %p and returns the card",
    async (method, done, completedAt) => {
      const runMutation = buildAuthorizedMutationMock().mockResolvedValueOnce({
        card: { ...linkCard, ...(completedAt ? { completedAt } : {}) },
        changed: true,
      });
      const response = await runHandler(
        cardByIdV1,
        {
          runMutation,
          runQuery: mock()
            .mockResolvedValueOnce("card_1")
            .mockResolvedValueOnce(linkCard),
        },
        doneRequest(method)
      );
      expect(response.status).toBe(200);
      expect(runMutation.mock.calls[1]?.[1]).toEqual({
        cardId: "card_1",
        done,
        userId: "user_1",
      });
      expect(await response.json()).toMatchObject({
        completedAt,
        id: "card_1",
        linkCategory: "movie",
      });
    }
  );

  test.each([
    ["TYPE_MISMATCH", "Only link cards can be marked done", 400],
    ["CONFLICT", "Restore this card from Trash before marking it done", 409],
  ])("/done maps %s to %p", async (code, message, status) => {
    const response = await runHandler(
      cardByIdV1,
      {
        runMutation: buildAuthorizedMutationMock().mockRejectedValueOnce(
          new ConvexError({ code, message })
        ),
        runQuery: mock()
          .mockResolvedValueOnce("card_1")
          .mockResolvedValueOnce({ ...linkCard, isDeleted: true }),
      },
      doneRequest("POST")
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code, error: message });
  });

  const savePdfRequest = (method = "POST") =>
    new Request("https://example.com/v1/cards/card_1/save-pdf", {
      method,
      headers: {
        Authorization:
          "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      },
    });
  const savePdf = (runAction: ReturnType<typeof mock>, card = linkCard) =>
    runHandler(
      cardByIdV1,
      {
        runAction,
        runMutation: buildAuthorizedMutationMock(),
        runQuery: mock()
          .mockResolvedValueOnce("card_1")
          .mockResolvedValueOnce(card),
      },
      savePdfRequest()
    );

  test.each([
    [true, 201],
    [false, 200],
  ])("/save-pdf answers created: %p with %p", async (created, status) => {
    const runAction = mock().mockResolvedValueOnce({
      cardId: "doc_1",
      created,
    });
    const response = await savePdf(runAction);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ cardId: "doc_1", created });
    expect(runAction.mock.calls[0]?.[1]).toEqual({
      cardId: "card_1",
      userId: "user_1",
    });
  });

  test.each([
    ["INVALID_INPUT", "This card has no PDF to save.", 400],
    ["CARD_LIMIT_REACHED", "Card limit reached.", 400],
    ["NOT_FOUND", "Card not found", 404],
    ["CONFLICT", "Restore this card from Trash before saving its PDF.", 409],
    ["IN_PROGRESS", "This PDF is already being saved.", 409],
    ["FILE_TOO_LARGE", "This PDF is too large.", 413],
    ["UNSUPPORTED_TYPE", "arXiv didn't send a PDF for this paper.", 415],
    ["SERVICE_UNAVAILABLE", "Couldn't get the PDF from arXiv.", 503],
  ])("/save-pdf maps %s to %p", async (code, message, status) => {
    const response = await savePdf(
      mock().mockRejectedValueOnce(new ConvexError({ code, message }))
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code, error: message });
  });

  test("/save-pdf answers a rate limit with 429 and Retry-After", async () => {
    const response = await savePdf(
      mock().mockRejectedValueOnce(
        new ConvexError({
          code: "RATE_LIMITED",
          message: "Too many cards created.",
          retryAt: Date.now() + 30_000,
        })
      )
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
  });

  test("/save-pdf on a card in Trash still reaches the save, which refuses it", async () => {
    const runAction = mock().mockRejectedValueOnce(
      new ConvexError({ code: "CONFLICT", message: "In Trash" })
    );
    const response = await savePdf(runAction, {
      ...linkCard,
      isDeleted: true,
    } as typeof linkCard);
    expect(response.status).toBe(409);
    expect(runAction).toHaveBeenCalledTimes(1);
  });

  test("GET /save-pdf is not a route", async () => {
    const runAction = mock();
    const response = await runHandler(
      cardByIdV1,
      {
        runAction,
        runMutation: buildAuthorizedMutationMock(),
        runQuery: mock().mockResolvedValueOnce("card_1"),
      },
      savePdfRequest("GET")
    );
    expect(response.status).toBe(404);
    expect(runAction).not.toHaveBeenCalled();
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
      mockActionCtx(
        withMappedOwner({
          runMutation: buildAuthorizedMutationMock().mockResolvedValueOnce({
            cardId: "card_1",
            requestedAt: 1,
          }),
          runQuery: mock()
            .mockResolvedValueOnce("card_1")
            .mockResolvedValueOnce({ _id: "card_1", userId: "user_1" }),
        })
      ),
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

  test.each(["POST", "DELETE"])(
    "%s /done is reachable through executePublicApiOperation, as MCP calls it",
    async (method) => {
      const link = { _id: "card_1", userId: "user_1", type: "link" };
      const response = await executePublicApiOperation(
        mockActionCtx(
          withMappedOwner({
            runMutation: buildAuthorizedMutationMock().mockResolvedValueOnce({
              card: { ...link, completedAt: method === "POST" ? 1 : undefined },
              changed: true,
            }),
            runQuery: mock()
              .mockResolvedValueOnce("card_1")
              .mockResolvedValueOnce(link),
          })
        ),
        {
          method,
          path: "/v1/cards/card_1/done",
          headers: {
            Authorization: `Bearer teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`,
          },
        }
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        completedAt: method === "POST" ? 1 : null,
      });
    }
  );

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

describe("listCardsV1 search modes", () => {
  const authorizedRequest = (query: string) =>
    new Request(`https://example.com/v1/cards?${query}`, {
      headers: {
        Authorization: `Bearer teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`,
      },
    });
  const emptyPage = {
    items: [],
    pageInfo: { hasMore: false, nextCursor: null },
  };
  const ranking = [{ cardId: "card_meaning", score: 0.5 }];

  const withWorker = async (
    answer: "ok" | "fail",
    run: (calls: string[]) => Promise<void>
  ) => {
    const previous = {
      base: process.env.FILES_BASE,
      secret: process.env.FILES_SIGNING_SECRET,
      fetch: globalThis.fetch,
    };
    const calls: string[] = [];
    process.env.FILES_BASE = "https://files.test";
    process.env.FILES_SIGNING_SECRET = "mode-test-secret";
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)).params.text);
      return Promise.resolve(
        answer === "ok"
          ? Response.json({
              ok: true,
              version: 1,
              requestId: "r",
              data: {
                found: true,
                matches: [{ id: "card_meaning", score: 0.5 }],
              },
            })
          : Response.json(
              {
                ok: false,
                error: { code: "INTERNAL", message: "boom", requestId: "r" },
              },
              { status: 500 }
            )
      );
    }) as any;
    try {
      await run(calls);
    } finally {
      process.env.FILES_BASE = previous.base;
      process.env.FILES_SIGNING_SECRET = previous.secret;
      globalThis.fetch = previous.fetch;
    }
  };

  const ctxFor = () => {
    const pageArgs: any[] = [];
    const runQuery = mock((ref: any, args: any): Promise<unknown> => {
      const name = getFunctionName(ref);
      if (name.endsWith("getUserShard")) {
        return Promise.resolve(0);
      }
      if (name.endsWith("getCachedRanking")) {
        return Promise.resolve(null);
      }
      if (name.endsWith("checkSimilarAnchor")) {
        return Promise.resolve(true);
      }
      pageArgs.push(args);
      return Promise.resolve(emptyPage);
    });
    const authorize = buildAuthorizedMutationMock();
    let authorized = false;
    const runMutation = mock((ref: any, args: any) => {
      if (!authorized) {
        authorized = true;
        return authorize(ref, args);
      }
      let name = "";
      try {
        name = getFunctionName(ref);
      } catch {
        name = "";
      }
      return Promise.resolve(
        name.endsWith("storeRanking")
          ? ranking
          : { ok: true, retryAfter: undefined }
      );
    });
    return { ctx: { runQuery, runMutation }, pageArgs };
  };

  test("rejects an unknown mode", async () => {
    const { ctx } = ctxFor();
    const response = await runHandler(
      listCardsV1,
      ctx,
      authorizedRequest("q=chair&mode=bogus")
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_INPUT" });
  });

  test("blends by default and says so", async () => {
    await withWorker("ok", async (calls) => {
      const { ctx, pageArgs } = ctxFor();
      const response = await runHandler(
        listCardsV1,
        ctx,
        authorizedRequest(`q=${encodeURIComponent("Cozy nook tag:home")}`)
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ searchMode: "hybrid" });
      expect(calls).toEqual(["cozy nook"]);
      expect(pageArgs[0]).toMatchObject({
        mode: "hybrid",
        semanticRanking: ranking,
      });
    });
  });

  test("passes semantic mode through", async () => {
    await withWorker("ok", async () => {
      const { ctx, pageArgs } = ctxFor();
      const response = await runHandler(
        listCardsV1,
        ctx,
        authorizedRequest("q=chair&mode=semantic")
      );
      expect(await response.json()).toMatchObject({ searchMode: "semantic" });
      expect(pageArgs[0]).toMatchObject({ mode: "semantic" });
    });
  });

  test("falls back to keyword results when the vector service fails", async () => {
    await withWorker("fail", async (calls) => {
      const { ctx, pageArgs } = ctxFor();
      const response = await runHandler(
        listCardsV1,
        ctx,
        authorizedRequest("q=chair")
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ searchMode: "keyword" });
      expect(calls).toHaveLength(1);
      expect(pageArgs[0]).not.toHaveProperty("semanticRanking");
    });
  });

  test("keyword mode and qualifier-only searches never call the vector service", async () => {
    await withWorker("ok", async (calls) => {
      for (const query of ["q=chair&mode=keyword", "q=tag%3Adesign"]) {
        const { ctx, pageArgs } = ctxFor();
        const response = await runHandler(
          listCardsV1,
          ctx,
          authorizedRequest(query)
        );
        expect(response.status).toBe(200);
        expect(pageArgs[0]).not.toHaveProperty("semanticRanking");
      }
      expect(calls).toEqual([]);
    });
  });

  test("a qualifier-only search reports keyword mode", async () => {
    const { ctx } = ctxFor();
    const response = await runHandler(
      listCardsV1,
      ctx,
      authorizedRequest("q=tag%3Adesign")
    );
    expect(await response.json()).toMatchObject({ searchMode: "keyword" });
  });

  test("similarTo needs a card id", async () => {
    const { ctx } = ctxFor();
    const response = await runHandler(
      listCardsV1,
      ctx,
      authorizedRequest("similarTo=not-a-card")
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_INPUT" });
  });

  test("similarTo lists a card's neighbors, or says why it can't", async () => {
    const anchor = "j979t50bv7gjxz2mazwwf5tes18gbvnt";
    await withWorker("ok", async () => {
      const { ctx, pageArgs } = ctxFor();
      const answer = await runHandler(
        listCardsV1,
        ctx,
        authorizedRequest(`similarTo=${anchor}&type=image`)
      );
      expect(answer.status).toBe(200);
      expect(await answer.json()).toMatchObject({
        searchMode: "semantic",
        similarity: "ok",
      });
      expect(pageArgs[0]).toMatchObject({
        similarity: { kind: "like", cardId: anchor },
        semanticRanking: ranking,
        type: "image",
      });

      const missing = ctxFor();
      missing.ctx.runQuery.mockImplementation((ref: any) =>
        Promise.resolve(
          getFunctionName(ref).endsWith("checkSimilarAnchor") ? false : 0
        )
      );
      const gone = await runHandler(
        listCardsV1,
        missing.ctx,
        authorizedRequest(`similarTo=${anchor}`)
      );
      expect(await gone.json()).toEqual({
        items: [],
        pageInfo: { hasMore: false, nextCursor: null },
        searchMode: "semantic",
        similarity: "unavailable",
      });
      expect(missing.pageArgs).toEqual([]);
    });
  });

  test("a different like: in q than similarTo matches nothing", async () => {
    const { ctx, pageArgs } = ctxFor();
    const response = await runHandler(
      listCardsV1,
      ctx,
      authorizedRequest(
        "similarTo=j979t50bv7gjxz2mazwwf5tes18gbvnt&q=like%3Aj97a1vaafgzkxkzag6rb6wt0gs8gbq0x"
      )
    );
    expect(await response.json()).toMatchObject({ items: [] });
    expect(pageArgs).toEqual([]);
  });

  test("a listing without q carries no searchMode", async () => {
    const { ctx } = ctxFor();
    ctx.runQuery.mockImplementation(async () => ({
      items: [],
      itemCursors: [],
      nextCursor: null,
      scannedRows: 0,
    }));
    const response = await runHandler(listCardsV1, ctx, authorizedRequest(""));
    expect(await response.json()).not.toHaveProperty("searchMode");
  });
});

describe("link image routes", () => {
  const AUTH = {
    Authorization: `Bearer teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`,
  };
  const linkCard = (overrides = {}) => ({
    _id: "card_1",
    content: "https://example.com",
    type: "link",
    userId: "user_1",
    ...overrides,
  });
  const call = (
    method: "DELETE" | "POST" | "PUT",
    path: string,
    {
      body,
      runAction,
      runMutation,
      runQuery,
    }: {
      body?: unknown;
      runAction?: unknown;
      runMutation?: unknown;
      runQuery?: unknown;
    } = {}
  ) =>
    executePublicApiOperation(
      withMappedOwner({
        runAction: runAction ?? mock().mockResolvedValue({}),
        runMutation: runMutation ?? buildAuthorizedMutationMock(),
        runQuery:
          runQuery ??
          mock().mockResolvedValueOnce("card_1").mockResolvedValue(linkCard()),
      } as any),
      { body, headers: AUTH, method, path }
    );

  test("POST thumbnail/upload signs an upload for the card", async () => {
    const upload = {
      expiresIn: 600,
      fileKey: "users/u/cards/upload-pending-v2/thumbnail-override-pending/k",
      maxFileSize: 20 * 1024 * 1024,
      method: "PUT",
      uploadUrl: "https://files.example.com/__upload/v1/k",
    };
    const runMutation =
      buildAuthorizedMutationMock().mockResolvedValueOnce(upload);
    const response = await call("POST", "/v1/cards/card_1/thumbnail/upload", {
      body: { fileSize: 1000, mimeType: "image/png" },
      runMutation,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(upload);
    expect(getFunctionName(runMutation.mock.calls[1][0])).toBe(
      "card/thumbnailOverride:createThumbnailUploadUrlForUser"
    );
    expect(runMutation.mock.calls[1][1]).toEqual({
      cardId: "card_1",
      fileSize: 1000,
      mimeType: "image/png",
      userId: "user_1",
    });
  });

  test("POST thumbnail/upload refuses a body with other fields", async () => {
    const response = await call("POST", "/v1/cards/card_1/thumbnail/upload", {
      body: { fileName: "a.png", fileSize: 1000, mimeType: "image/png" },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_INPUT" });
  });

  test("PUT thumbnail applies the upload and returns the card", async () => {
    const runAction = mock().mockResolvedValue({
      changeId: "change_1",
      undoUntil: 1,
    });
    const runQuery = mock()
      .mockResolvedValueOnce("card_1")
      .mockResolvedValueOnce(linkCard())
      .mockResolvedValueOnce(
        linkCard({
          linkPreviewImageUrl: "https://files.example.com/chosen",
          thumbnailOverride: {
            height: 1,
            storageKey: "k",
            updatedAt: 1,
            width: 1,
          },
        })
      );
    const response = await call("PUT", "/v1/cards/card_1/thumbnail", {
      body: { fileKey: "users/u/k" },
      runAction,
      runQuery,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "card_1",
      linkPreviewImageUrl: "https://files.example.com/chosen",
      thumbnailOverridden: true,
    });
    expect(getFunctionName(runAction.mock.calls[0][0])).toBe(
      "card/thumbnailOverride:setLinkThumbnailForUser"
    );
    expect(runAction.mock.calls[0][1]).toEqual({
      cardId: "card_1",
      fileKey: "users/u/k",
      userId: "user_1",
    });
  });

  test.each([
    ["TYPE_MISMATCH", 400],
    ["UNSUPPORTED_TYPE", 400],
    ["INVALID_INPUT", 400],
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
    ["FILE_TOO_LARGE", 413],
  ])("PUT thumbnail answers %s with %d", async (code, status) => {
    const response = await call("PUT", "/v1/cards/card_1/thumbnail", {
      body: { fileKey: "users/u/k" },
      runAction: mock().mockRejectedValue(
        new ConvexError({ code, message: "refused" })
      ),
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code, error: "refused" });
  });

  test("PUT thumbnail maps the rate limit to 429 with Retry-After", async () => {
    const response = await call("PUT", "/v1/cards/card_1/thumbnail", {
      body: { fileKey: "users/u/k" },
      runAction: mock().mockRejectedValue(
        new ConvexError({
          code: "RATE_LIMITED",
          message: "You've changed a lot of images. Try again in a minute.",
          retryAt: Date.now() + 30_000,
        })
      ),
    });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  test("DELETE thumbnail resets and returns the card", async () => {
    const runMutation = buildAuthorizedMutationMock().mockResolvedValueOnce({
      changeId: null,
      undoUntil: null,
    });
    const response = await call("DELETE", "/v1/cards/card_1/thumbnail", {
      runMutation,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "card_1",
      thumbnailOverridden: false,
    });
    expect(getFunctionName(runMutation.mock.calls[1][0])).toBe(
      "card/thumbnailOverride:resetLinkThumbnailForUser"
    );
  });

  test("a card in Trash reaches the backend, which answers 409", async () => {
    const runMutation = buildAuthorizedMutationMock().mockRejectedValueOnce(
      new ConvexError({ code: "CONFLICT", message: "In Trash" })
    );
    const response = await call("DELETE", "/v1/cards/card_1/thumbnail", {
      runMutation,
      runQuery: mock()
        .mockResolvedValueOnce("card_1")
        .mockResolvedValue(linkCard({ isDeleted: true })),
    });
    expect(response.status).toBe(409);
  });

  test("the PUT route is served by the card-by-id handler", async () => {
    const response = await runHandler(
      cardByIdV1,
      {
        runAction: mock().mockResolvedValue({ changeId: "c", undoUntil: 1 }),
        runMutation: buildAuthorizedMutationMock(),
        runQuery: mock()
          .mockResolvedValueOnce("card_1")
          .mockResolvedValue(linkCard()),
      },
      new Request("https://example.com/v1/cards/card_1/thumbnail", {
        body: JSON.stringify({ fileKey: "users/u/k" }),
        headers: { ...AUTH, "Content-Type": "application/json" },
        method: "PUT",
      })
    );
    expect(response.status).toBe(200);
  });
});

describe("page snapshots", () => {
  const AUTH = {
    Authorization: `Bearer teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`,
  };
  const upload = {
    expiresIn: 600,
    fileKey: "users/u/cards/upload-pending-v2/page-snapshot/s1",
    maxFileSize: 20 * 1024 * 1024,
    method: "PUT",
    uploadUrl: "https://files.example.com/__upload/v1/s1",
  };
  const post = (body: unknown, runMutation = buildAuthorizedMutationMock()) =>
    executePublicApiOperation(
      withMappedOwner({
        runMutation,
        runQuery: mock().mockResolvedValue(null),
      } as any),
      { body, headers: AUTH, method: "POST", path: "/v1/page-snapshots/upload" }
    );

  test("signs an upload for the page's gzipped size", async () => {
    const runMutation =
      buildAuthorizedMutationMock().mockResolvedValueOnce(upload);
    const response = await post({ bytes: 4096 }, runMutation);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(upload);
    expect(getFunctionName(runMutation.mock.calls[1][0])).toBe(
      "publicApiPageSnapshots:createPageSnapshotUploadForUser"
    );
    expect(runMutation.mock.calls[1][1]).toEqual({
      bytes: 4096,
      userId: "user_1",
    });
  });

  test("refuses more than 20 MiB with 413 before signing anything", async () => {
    const runMutation = buildAuthorizedMutationMock();
    const response = await post({ bytes: 20 * 1024 * 1024 + 1 }, runMutation);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      code: "PAGE_SNAPSHOT_TOO_LARGE",
    });
    expect(
      runMutation.mock.calls.map((call: unknown[]) =>
        getFunctionName(call[0] as never)
      )
    ).not.toContain("publicApiPageSnapshots:createPageSnapshotUploadForUser");
  });

  test.each([
    [{}, "`bytes` must be a positive whole number"],
    [{ bytes: 1.5 }, "`bytes` must be a positive whole number"],
    [{ bytes: 10, fileName: "page.html" }, "Unknown field `fileName`"],
  ])("refuses %j", async (body, error) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "INVALID_INPUT", error });
  });

  test("a spent rate limit answers 429 with when to retry", async () => {
    const retryAt = Date.now() + 30_000;
    const runMutation = buildAuthorizedMutationMock().mockRejectedValueOnce(
      new ConvexError({
        code: "RATE_LIMITED",
        limit: 60,
        message: "Too many page snapshots. Try again in a minute.",
        retryAt,
      })
    );
    const response = await post({ bytes: 4096 }, runMutation);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(await response.json()).toMatchObject({
      code: "RATE_LIMITED",
      retryAt,
    });
  });

  test("POST /v1/cards hands the snapshot key to the save", async () => {
    const runMutation = buildAuthorizedMutationMock().mockResolvedValue({
      cardId: "card_1",
      status: "created",
    });
    const response = await executePublicApiOperation(
      withMappedOwner({
        runMutation,
        runQuery: mock().mockResolvedValue(null),
      } as any),
      {
        body: {
          pageSnapshotKey: upload.fileKey,
          url: "https://example.com/post",
        },
        headers: AUTH,
        method: "POST",
        path: "/v1/cards",
      }
    );
    expect(response.status).toBe(200);
    const save = runMutation.mock.calls.find(
      (call: unknown[]) =>
        getFunctionName(call[0] as never) ===
        "publicApi/cardsForUser:quickSaveForUser"
    );
    expect(save?.[1]).toMatchObject({
      pageSnapshotKey: upload.fileKey,
      url: "https://example.com/post",
    });
  });

  test("a card says what its saved copy is, never where it is", () => {
    const card = {
      _creationTime: 1,
      _id: "card_1",
      content: "https://example.com/post",
      createdAt: 1,
      pageArchive: {
        bytes: 2_400_000,
        capturedAt: 1_792_368_000_000,
        kind: "full",
        source: "extension",
        sourceUrl: "https://example.com/post",
        storageKey: "users/u/cards/card_1/page-archive/r1-archive.html",
      },
      type: "link",
      updatedAt: 2,
      url: "https://example.com/post",
      userId: "user_1",
    };
    const serialized = serializeCard(card as never, "https://example.com/v1");
    expect(serialized.archive).toEqual({
      bytes: 2_400_000,
      capturedAt: 1_792_368_000_000,
      kind: "full",
    });
    expect(JSON.stringify(serialized)).not.toContain("page-archive");
    expect(
      serializeCard(
        { ...card, pageArchive: undefined } as never,
        "https://example.com/v1"
      ).archive
    ).toBeNull();
  });
});
