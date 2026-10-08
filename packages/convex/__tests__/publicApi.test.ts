// @ts-nocheck

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ConvexError } from "convex/values";
import { r2MockModuleFactory } from "./helpers/r2Mock.test-utils";
import {
  inlineSearchSyncDb,
  withMappedOwner,
} from "./helpers/session.test-utils";

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
    ctx: withMappedOwner({ db: { query } }) as any,
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
    const bulk = module.executeBulkCardsForUser;
    executeBulkCardsForUser = {
      handler: (ctx: any, args: any) =>
        (bulk.handler ?? bulk)(withMappedOwner(ctx), args),
    };
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
        ...inlineSearchSyncDb(),
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
    const firstScan = await handler(withMappedOwner(ctx), {
      scanLimit: 100,
      userId: "user_1",
    });
    expect(invocationPaginateCalls).toBe(1);

    invocationPaginateCalls = 0;
    const secondScan = await handler(withMappedOwner(ctx), {
      cursor: firstScan.nextCursor,
      scanLimit: 100,
      userId: "user_1",
    });

    expect(secondScan.items.map((card: any) => card._id)).toEqual(["card_2"]);
    expect(secondScan.nextCursor).toBeNull();
    expect(invocationPaginateCalls).toBe(1);
    expect(requestedCursors).toEqual([null, "cursor-1"]);
  });

  test("scanCardsPageForUser hides soft-deleted cards from list pages", async () => {
    const pagination = buildSinglePaginateContext({
      continueCursor: "",
      isDone: true,
      page: [
        buildBaseCard({ _id: "card_active", createdAt: 2, updatedAt: 2 }),
        buildBaseCard({
          _id: "card_trashed",
          createdAt: 1,
          deletedAt: 99,
          isDeleted: true,
          updatedAt: 1,
        }),
      ],
    });
    const handler =
      (scanCardsPageForUser as any).handler ?? scanCardsPageForUser;

    pagination.beginInvocation();
    const scan = await handler(pagination.ctx, {
      scanLimit: 100,
      userId: "user_1",
    });

    expect(scan.items.map((card: any) => card._id)).toEqual(["card_active"]);
    expect(scan.scannedRows).toBe(2);
  });

  test("scanCardsPageForUser resumes a multi-type page without skips", async () => {
    const pagination = buildSinglePaginateContext({
      continueCursor: "cursor-1",
      isDone: false,
      page: [
        buildBaseCard({ _id: "text_1", type: "text" }),
        buildBaseCard({ _id: "image_1", type: "image" }),
        buildBaseCard({ _id: "quote_1", type: "quote" }),
        buildBaseCard({ _id: "link_1", type: "link" }),
      ],
    });
    const handler =
      (scanCardsPageForUser as any).handler ?? scanCardsPageForUser;
    const args = { scanLimit: 100, types: ["image", "link"], userId: "user_1" };

    pagination.beginInvocation();
    const first = await handler(pagination.ctx, args);
    expect(first.items.map((card: any) => card._id)).toEqual([
      "image_1",
      "link_1",
    ]);

    pagination.beginInvocation();
    const second = await handler(pagination.ctx, {
      ...args,
      cursor: first.itemCursors[0],
    });
    expect(second.items.map((card: any) => card._id)).toEqual(["link_1"]);
  });

  test("searchCardsPageForUser paginates across selected type indexes", async () => {
    const module = await import("../publicApi");
    const handler =
      (module.searchCardsPageForUser as any).handler ??
      module.searchCardsPageForUser;
    const cards = {
      quote_1: buildBaseCard({ _id: "quote_1", type: "quote", createdAt: 3 }),
      palette_1: buildBaseCard({
        _id: "palette_1",
        type: "palette",
        createdAt: 2,
      }),
      text_1: buildBaseCard({ _id: "text_1", type: "text", createdAt: 4 }),
    };
    const searchedTypes: string[] = [];
    const ctx = {
      db: {
        ...inlineSearchSyncDb(),
        get: mock((_table: string, id: keyof typeof cards) => cards[id]),
        query: mock(() => ({
          withSearchIndex: mock(
            (_index: string, build: (range: any) => void) => {
              let selectedType: string | undefined;
              const range = {
                search: () => range,
                eq: (field: string, value: string) => {
                  if (field === "type") {
                    selectedType = value;
                  }
                  return range;
                },
              };
              build(range);
              searchedTypes.push(selectedType ?? "all");
              return {
                take: mock().mockResolvedValue(
                  Object.values(cards)
                    .filter((card) => card.type === selectedType)
                    .map((card) => ({ cardId: card._id }))
                ),
              };
            }
          ),
        })),
      },
    } as any;
    const args = {
      limit: 1,
      searchQuery: "Native",
      types: ["quote", "palette"],
      userId: "user_1",
    };
    const first = await handler(withMappedOwner(ctx), args);
    const second = await handler(withMappedOwner(ctx), {
      ...args,
      cursor: first.pageInfo.nextCursor,
    });

    expect(first.items.map((card: any) => card._id)).toEqual(["quote_1"]);
    expect(second.items.map((card: any) => card._id)).toEqual(["palette_1"]);
    expect(second.pageInfo.hasMore).toBe(false);
    expect(searchedTypes).toEqual(["quote", "palette", "quote", "palette"]);
  });

  test("listCardChangesForUser returns active items and soft-deleted ids", async () => {
    const module = await import("../publicApi");
    const handler =
      (module.listCardChangesForUser as any).handler ??
      module.listCardChangesForUser;
    const ctx = {
      db: {
        ...inlineSearchSyncDb(),
        query: mock(() => ({
          withIndex: mock().mockReturnValue({
            order: mock().mockReturnValue({
              paginate: mock().mockResolvedValue({
                continueCursor: "",
                isDone: true,
                page: [
                  buildBaseCard({
                    _id: "card_active",
                    updatedAt: 10,
                  }),
                  buildBaseCard({
                    _id: "card_trashed",
                    isDeleted: true,
                    deletedAt: 11,
                    updatedAt: 11,
                  }),
                ],
              }),
            }),
          }),
        })),
      },
    } as any;

    const result = await handler(withMappedOwner(ctx), {
      limit: 50,
      since: 0,
      userId: "user_1",
    });

    expect(result.items.map((card: any) => card._id)).toEqual(["card_active"]);
    expect(result.deletedIds).toEqual(["card_trashed"]);
    expect(result.pageInfo).toEqual({ hasMore: false, nextCursor: null });
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
          ...inlineSearchSyncDb(),
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
    const billingModule = await import("../billing");
    const managerModule = await import("../workflows/manager");
    const originalGetSubscription = billingModule.polar.getCurrentSubscription;
    const originalWorkflowStart = managerModule.workflow.start;
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
          runMutation: mock().mockResolvedValue({ ok: true }),
          db: {
            ...inlineSearchSyncDb(),
            insert,
            patch: mock().mockResolvedValue(null),
            query: (table: string) => ({
              withIndex: () => {
                if (table === "userCardUsage") {
                  return {
                    unique: mock().mockResolvedValue({
                      _id: "usage_1",
                      activeCardCount: 0,
                      isCountExact: true,
                      isSaturated: false,
                      shardVersion: 1,
                      shardedAt: 1,
                    }),
                  };
                }
                if (table === "userCardUsageShards") {
                  return {
                    unique: mock().mockResolvedValue({
                      _id: "usage_shard_1",
                      activeCardCount: 0,
                      shard: 0,
                      updatedAt: 1,
                      userId: "user_1",
                    }),
                  };
                }
                return {
                  take: mock().mockResolvedValue([]),
                  unique: mock().mockResolvedValue(null),
                };
              },
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
          ...inlineSearchSyncDb(),
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
          ...inlineSearchSyncDb(),
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
        runMutation: mock().mockResolvedValue({ ok: true }),
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
    expect(scheduler.runAfter).toHaveBeenCalledTimes(2);
  });
});

describe("public API rate limits", () => {
  const runHandler = async (name: string, ctx: any, args: any) => {
    const fn = (await import("../publicApi"))[name];
    return (fn.handler ?? fn)(ctx, args);
  };

  test("checkApiRateLimit returns rate-limited result on contention errors", async () => {
    const runMutation = mock().mockRejectedValue(
      new Error(
        'Documents read from or written to the "rateLimits" table changed while this mutation was being run and on every subsequent retry.'
      )
    );

    const result = await runHandler(
      "checkApiRateLimit",
      { runMutation } as any,
      {
        rateLimitKey: "key:key_1",
      }
    );

    expect(result.ok).toBe(false);
    expect(typeof result.retryAt).toBe("number");
  });

  test("checkApiRateLimit rejects an empty rate limit key without calling the limiter", async () => {
    const runMutation = mock();

    const result = await runHandler(
      "checkApiRateLimit",
      { runMutation } as any,
      {
        rateLimitKey: "   ",
      }
    );

    expect(result.ok).toBe(false);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("checkApiRateLimit keys the limiter on the provided identity", async () => {
    const runMutation = mock().mockResolvedValue({ ok: true });

    const result = await runHandler(
      "checkApiRateLimit",
      { runMutation } as any,
      {
        rateLimitKey: "key:key_42",
      }
    );

    expect(result.ok).toBe(true);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0][1]).toMatchObject({
      key: "key:key_42",
      name: "publicApiRequests",
    });
  });

  test("consumeInvalidApiAuthLimit uses a single shared bucket key", async () => {
    const runMutation = mock().mockResolvedValue({ ok: true });

    const result = await runHandler(
      "consumeInvalidApiAuthLimit",
      { runMutation } as any,
      {}
    );

    expect(result.ok).toBe(true);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0][1]).toMatchObject({
      key: "public-api-invalid-auth",
      name: "invalidApiAuth",
    });
  });

  test("consumeInvalidApiAuthLimit maps contention errors to a retryable result", async () => {
    const runMutation = mock().mockRejectedValue(
      new Error(
        'Documents read from or written to the "rateLimits" table changed while this mutation was being run and on every subsequent retry.'
      )
    );

    const result = await runHandler(
      "consumeInvalidApiAuthLimit",
      { runMutation } as any,
      {}
    );

    expect(result.ok).toBe(false);
    expect(typeof result.retryAt).toBe("number");
  });
});
