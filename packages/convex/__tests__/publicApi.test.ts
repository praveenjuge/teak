// @ts-nocheck

import { beforeEach, describe, expect, mock, test } from "bun:test";

const buildBaseCard = (overrides: Record<string, unknown> = {}) => ({
  _creationTime: 1,
  _id: "card_1",
  aiSummary: undefined,
  aiTags: [],
  content: "Hello",
  createdAt: 1,
  deletedAt: undefined,
  fileId: undefined,
  isDeleted: undefined,
  isFavorited: false,
  metadata: undefined,
  metadataDescription: undefined,
  metadataStatus: undefined,
  metadataTitle: undefined,
  notes: undefined,
  processingStatus: undefined,
  tags: [],
  thumbnailId: undefined,
  type: "text",
  updatedAt: 1,
  url: undefined,
  userId: "user_1",
  ...overrides,
});

describe("publicApi", () => {
  let executeBulkCardsForUser: any;
  let listCardsPageForUser: any;

  beforeEach(async () => {
    const module = await import("../publicApi");
    executeBulkCardsForUser = module.executeBulkCardsForUser;
    listCardsPageForUser = module.listCardsPageForUser;
  });

  test("listCardsPageForUser keeps remaining matches on the same page", async () => {
    const secondPage = {
      continueCursor: "cursor-2",
      isDone: false,
      page: [
        buildBaseCard({
          _id: "card_2",
          createdAt: 2,
          isFavorited: true,
          updatedAt: 2,
        }),
        buildBaseCard({
          _id: "card_3",
          createdAt: 3,
          isFavorited: true,
          updatedAt: 3,
        }),
      ],
    };
    const paginate = mock()
      .mockResolvedValueOnce({
        continueCursor: "cursor-1",
        isDone: false,
        page: [
          buildBaseCard({ _id: "card_skip", createdAt: 0, updatedAt: 0 }),
          buildBaseCard({
            _id: "card_1",
            createdAt: 1,
            isFavorited: true,
            updatedAt: 1,
          }),
        ],
      })
      .mockResolvedValueOnce(secondPage)
      .mockResolvedValueOnce({
        ...secondPage,
        continueCursor: null,
        isDone: true,
      });
    const baseQuery = {
      order: mock().mockReturnValue({
        paginate,
      }),
    };
    const query = {
      withIndex: mock().mockReturnValue(baseQuery),
    };
    const ctx = {
      db: {
        query: mock().mockReturnValue(query),
      },
      storage: {
        getUrl: mock(),
      },
    } as any;
    const handler = (listCardsPageForUser as any).handler ?? listCardsPageForUser;

    const firstPage = await handler(ctx, {
      createdAfter: 0,
      favorited: true,
      limit: 2,
      userId: "user_1",
    });

    expect(firstPage.items.map((card: any) => card._id)).toEqual([
      "card_1",
      "card_2",
    ]);
    expect(firstPage.pageInfo.hasMore).toBe(true);

    const secondResult = await handler(ctx, {
      createdAfter: 0,
      cursor: firstPage.pageInfo.nextCursor,
      favorited: true,
      limit: 2,
      userId: "user_1",
    });

    expect(secondResult.items.map((card: any) => card._id)).toEqual(["card_3"]);
  });

  test("executeBulkCardsForUser rejects create items without content or url", async () => {
    const handler =
      (executeBulkCardsForUser as any).handler ?? executeBulkCardsForUser;

    const result = await handler(
      {
        db: {
          normalizeId: mock(),
        },
      },
      {
        items: [{}],
        operation: "create",
        userId: "user_1",
      }
    );

    expect(result.summary).toEqual({
      failed: 1,
      succeeded: 0,
      total: 1,
    });
    expect(result.results[0]).toMatchObject({
      error: "Each create item must include `content` or `url`",
      index: 0,
      status: "error",
    });
  });

  test("executeBulkCardsForUser validates favorite booleans", async () => {
    const handler =
      (executeBulkCardsForUser as any).handler ?? executeBulkCardsForUser;

    const result = await handler(
      {
        db: {
          normalizeId: mock().mockReturnValue("card_1"),
        },
      },
      {
        items: [{ cardId: "card_1", isFavorited: "yes" }],
        operation: "favorite",
        userId: "user_1",
      }
    );

    expect(result.summary).toEqual({
      failed: 1,
      succeeded: 0,
      total: 1,
    });
    expect(result.results[0]).toMatchObject({
      error: "Each favorite item must include `isFavorited` as a boolean",
      index: 0,
      status: "error",
    });
  });

  test("executeBulkCardsForUser schedules processing after deferred updates", async () => {
    const handler =
      (executeBulkCardsForUser as any).handler ?? executeBulkCardsForUser;
    const scheduler = {
      runAfter: mock().mockResolvedValue(null),
    };

    const result = await handler(
      {
        db: {
          get: mock().mockResolvedValue(
            buildBaseCard({
              _id: "card_1",
              content: "Before",
              type: "link",
              updatedAt: 1,
              url: "https://example.com/before",
            })
          ),
          normalizeId: mock().mockReturnValue("card_1"),
          patch: mock().mockResolvedValue(null),
        },
        scheduler,
      },
      {
        items: [
          {
            cardId: "card_1",
            content: "After",
          },
        ],
        operation: "update",
        userId: "user_1",
      }
    );

    expect(result.summary).toEqual({
      failed: 0,
      succeeded: 1,
      total: 1,
    });
    expect(scheduler.runAfter).toHaveBeenCalledTimes(1);
  });
});
