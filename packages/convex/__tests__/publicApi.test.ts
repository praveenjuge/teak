// @ts-nocheck

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ConvexError } from "convex/values";
import { r2MockModuleFactory } from "./helpers/r2Mock.test-utils";

mock.module("../storage/r2", r2MockModuleFactory);

const buildBaseCard = (overrides: Record<string, unknown> = {}) => ({
  _creationTime: 1,
  _id: "card_1",
  aiSummary: undefined,
  aiTags: [],
  content: "Hello",
  createdAt: 1,
  deletedAt: undefined,
  fileKey: undefined,
  isDeleted: undefined,
  isFavorited: false,
  metadata: undefined,
  metadataDescription: undefined,
  metadataStatus: undefined,
  metadataTitle: undefined,
  notes: undefined,
  processingStatus: undefined,
  tags: [],
  thumbnailKey: undefined,
  type: "text",
  updatedAt: 1,
  url: undefined,
  userId: "user_1",
  ...overrides,
});

const buildSingleUsePaginationContext = (
  pagesByCursor: Record<string, unknown>
) => {
  const requestedCursors: Array<string | null> = [];
  const query = mock(() => {
    let chained = false;
    const baseQuery = {
      order: mock(() => {
        if (chained) {
          throw new Error(
            "A query can only be chained once and can't be chained after iteration begins."
          );
        }
        chained = true;
        return {
          paginate: mock(({ cursor }: { cursor: string | null }) => {
            requestedCursors.push(cursor);
            return Promise.resolve(pagesByCursor[cursor ?? "start"]);
          }),
        };
      }),
    };

    return {
      withIndex: mock().mockReturnValue(baseQuery),
    };
  });

  return {
    ctx: { db: { query } } as any,
    query,
    requestedCursors,
  };
};

describe("publicApi", () => {
  let executeBulkCardsForUser: any;
  let listCardsPageForUser: any;

  beforeEach(async () => {
    const module = await import("../publicApi");
    executeBulkCardsForUser = module.executeBulkCardsForUser;
    listCardsPageForUser = module.listCardsPageForUser;
  });

  test("listCardsPageForUser uses fresh queries and resumes within a page", async () => {
    const { ctx, query, requestedCursors } = buildSingleUsePaginationContext({
      start: {
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
      },
      "cursor-1": {
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
      },
      "cursor-2": {
        continueCursor: null,
        isDone: true,
        page: [],
      },
    });
    const handler =
      (listCardsPageForUser as any).handler ?? listCardsPageForUser;

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
    expect(query).toHaveBeenCalledTimes(2);
    expect(requestedCursors).toEqual([null, "cursor-1"]);

    const secondResult = await handler(ctx, {
      createdAfter: 0,
      cursor: firstPage.pageInfo.nextCursor,
      favorited: true,
      limit: 2,
      userId: "user_1",
    });

    expect(secondResult.items.map((card: any) => card._id)).toEqual(["card_3"]);
    expect(secondResult.pageInfo.hasMore).toBe(false);
    expect(secondResult.pageInfo.nextCursor).toBeNull();
    expect(query).toHaveBeenCalledTimes(4);
    expect(requestedCursors).toEqual([
      null,
      "cursor-1",
      "cursor-1",
      "cursor-2",
    ]);
  });

  test("listCardsPageForUser reports hasMore when a page fills exactly to the limit", async () => {
    const pagesByCursor: Record<string, any> = {
      start: {
        continueCursor: "cursor-1",
        isDone: false,
        page: [
          buildBaseCard({ _id: "card_1", createdAt: 1, updatedAt: 1 }),
          buildBaseCard({ _id: "card_2", createdAt: 2, updatedAt: 2 }),
        ],
      },
      "cursor-1": {
        continueCursor: null,
        isDone: true,
        page: [buildBaseCard({ _id: "card_3", createdAt: 3, updatedAt: 3 })],
      },
    };
    const paginate = mock(({ cursor }: { cursor: string | null }) =>
      Promise.resolve(pagesByCursor[cursor ?? "start"])
    );
    const baseQuery = {
      order: mock().mockReturnValue({ paginate }),
    };
    const query = {
      withIndex: mock().mockReturnValue(baseQuery),
    };
    const ctx = {
      db: {
        query: mock().mockReturnValue(query),
      },
    } as any;
    const handler =
      (listCardsPageForUser as any).handler ?? listCardsPageForUser;

    const firstPage = await handler(ctx, { limit: 2, userId: "user_1" });

    expect(firstPage.items.map((card: any) => card._id)).toEqual([
      "card_1",
      "card_2",
    ]);
    expect(firstPage.pageInfo.hasMore).toBe(true);
    expect(firstPage.pageInfo.nextCursor).not.toBeNull();

    const secondResult = await handler(ctx, {
      cursor: firstPage.pageInfo.nextCursor,
      limit: 2,
      userId: "user_1",
    });

    expect(secondResult.items.map((card: any) => card._id)).toEqual(["card_3"]);
    expect(secondResult.pageInfo.hasMore).toBe(false);
    expect(secondResult.pageInfo.nextCursor).toBeNull();
  });

  test("executeBulkCardsForUser rejects batches over the item limit", async () => {
    const handler =
      (executeBulkCardsForUser as any).handler ?? executeBulkCardsForUser;
    const normalizeId = mock();

    let thrown: unknown;
    try {
      await handler(
        {
          db: { normalizeId },
          scheduler: { runAfter: mock() },
        },
        {
          items: Array.from({ length: 101 }, (_, index) => ({
            cardId: `card_${index}`,
            isFavorited: true,
          })),
          operation: "favorite",
          userId: "user_1",
        }
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConvexError);
    expect((thrown as any).data?.code).toBe("INVALID_INPUT");
    // Guard runs before any per-item work, so no card lookups happen.
    expect(normalizeId).not.toHaveBeenCalled();
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
