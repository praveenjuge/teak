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

const buildSinglePaginateContext = (page: unknown) => {
  const requestedCursors: Array<string | null> = [];
  let invocationPaginateCalls = 0;
  const query = mock(() => {
    const baseQuery = {
      order: mock(() => ({
        paginate: mock(
          ({
            cursor,
            maximumRowsRead,
            numItems,
          }: {
            cursor: string | null;
            maximumRowsRead: number;
            numItems: number;
          }) => {
            invocationPaginateCalls += 1;
            if (invocationPaginateCalls > 1) {
              throw new Error(
                "This query or mutation function ran multiple paginated queries."
              );
            }
            requestedCursors.push(cursor);
            expect(maximumRowsRead).toBe(100);
            expect(numItems).toBe(100);
            return Promise.resolve(page);
          }
        ),
      })),
    };

    return {
      withIndex: mock().mockReturnValue(baseQuery),
    };
  });

  return {
    beginInvocation: () => {
      invocationPaginateCalls = 0;
    },
    ctx: { db: { query } } as any,
    getInvocationPaginateCalls: () => invocationPaginateCalls,
    query,
    requestedCursors,
  };
};

describe("publicApi", () => {
  let executeBulkCardsForUser: any;
  let scanCardsPageForUser: any;

  beforeEach(async () => {
    const module = await import("../publicApi");
    executeBulkCardsForUser = module.executeBulkCardsForUser;
    scanCardsPageForUser = module.scanCardsPageForUser;
  });

  test("scanCardsPageForUser performs one paginate and resumes within that page", async () => {
    const pagination = buildSinglePaginateContext({
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
        buildBaseCard({
          _id: "card_2",
          createdAt: 2,
          isFavorited: true,
          updatedAt: 2,
        }),
      ],
    });
    const handler =
      (scanCardsPageForUser as any).handler ?? scanCardsPageForUser;

    pagination.beginInvocation();
    const firstScan = await handler(pagination.ctx, {
      createdAfter: 0,
      favorited: true,
      scanLimit: 100,
      userId: "user_1",
    });

    expect(firstScan.items.map((card: any) => card._id)).toEqual([
      "card_1",
      "card_2",
    ]);
    expect(firstScan.itemCursors).toHaveLength(2);
    expect(firstScan.nextCursor).not.toBeNull();
    expect(firstScan.scannedRows).toBe(3);
    expect(pagination.getInvocationPaginateCalls()).toBe(1);

    pagination.beginInvocation();
    const resumedScan = await handler(pagination.ctx, {
      createdAfter: 0,
      cursor: firstScan.itemCursors[0],
      favorited: true,
      scanLimit: 100,
      userId: "user_1",
    });

    expect(resumedScan.items.map((card: any) => card._id)).toEqual(["card_2"]);
    expect(pagination.getInvocationPaginateCalls()).toBe(1);
    expect(pagination.query).toHaveBeenCalledTimes(2);
    expect(pagination.requestedCursors).toEqual([null, null]);
  });

  test("scanCardsPageForUser advances to the next physical page", async () => {
    const requestedCursors: Array<string | null> = [];
    let invocationPaginateCalls = 0;
    const pagesByCursor: Record<string, any> = {
      start: {
        continueCursor: "cursor-1",
        isDone: false,
        page: [buildBaseCard({ _id: "card_1" })],
      },
      "cursor-1": {
        continueCursor: "",
        isDone: true,
        page: [buildBaseCard({ _id: "card_2" })],
      },
    };
    const ctx = {
      db: {
        query: mock(() => ({
          withIndex: mock().mockReturnValue({
            order: mock().mockReturnValue({
              paginate: mock(({ cursor }: { cursor: string | null }) => {
                invocationPaginateCalls += 1;
                if (invocationPaginateCalls > 1) {
                  throw new Error(
                    "This query or mutation function ran multiple paginated queries."
                  );
                }
                requestedCursors.push(cursor);
                return Promise.resolve(pagesByCursor[cursor ?? "start"]);
              }),
            }),
          }),
        })),
      },
    } as any;
    const handler =
      (scanCardsPageForUser as any).handler ?? scanCardsPageForUser;

    invocationPaginateCalls = 0;
    const firstScan = await handler(ctx, {
      scanLimit: 100,
      userId: "user_1",
    });
    expect(invocationPaginateCalls).toBe(1);

    invocationPaginateCalls = 0;
    const secondScan = await handler(ctx, {
      cursor: firstScan.nextCursor,
      scanLimit: 100,
      userId: "user_1",
    });

    expect(secondScan.items.map((card: any) => card._id)).toEqual(["card_2"]);
    expect(secondScan.nextCursor).toBeNull();
    expect(invocationPaginateCalls).toBe(1);
    expect(requestedCursors).toEqual([null, "cursor-1"]);
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

  test("executeBulkCardsForUser preserves explicit text and enforces its byte limit", async () => {
    const rateLimitsModule = await import("../shared/rateLimits");
    const billingModule = await import("../billing");
    const managerModule = await import("../workflows/manager");
    const originalLimit = rateLimitsModule.rateLimiter.limit;
    const originalGetSubscription = billingModule.polar.getCurrentSubscription;
    const originalWorkflowStart = managerModule.workflow.start;
    rateLimitsModule.rateLimiter.limit = mock().mockResolvedValue({ ok: true });
    billingModule.polar.getCurrentSubscription = mock().mockResolvedValue(null);
    managerModule.workflow.start = mock().mockResolvedValue(undefined);

    try {
      const handler =
        (executeBulkCardsForUser as any).handler ?? executeBulkCardsForUser;
      const source = `\uFEFF${"a".repeat(512 * 1024 - 3)}`;
      expect(new TextEncoder().encode(source)).toHaveLength(512 * 1024);
      const insert = mock().mockResolvedValue("card_1");

      const result = await handler(
        {
          db: {
            insert,
            query: () => ({
              withIndex: () => ({ take: mock().mockResolvedValue([]) }),
            }),
          },
          scheduler: { runAfter: mock().mockResolvedValue(null) },
        },
        {
          items: [
            { cardType: "text", content: source },
            { cardType: "text", content: `${"a".repeat(512 * 1024)}b` },
          ],
          operation: "create",
          userId: "user_1",
        }
      );

      expect(result.summary).toEqual({
        failed: 1,
        succeeded: 1,
        total: 2,
      });
      expect(insert.mock.calls[0]?.[1]).toMatchObject({
        content: source,
        type: "text",
      });
      expect(result.results[1]).toMatchObject({
        code: "CONTENT_TOO_LARGE",
        status: "error",
      });
    } finally {
      rateLimitsModule.rateLimiter.limit = originalLimit;
      billingModule.polar.getCurrentSubscription = originalGetSubscription;
      managerModule.workflow.start = originalWorkflowStart;
    }
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
