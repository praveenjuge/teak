// @ts-nocheck
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  checkApiRateLimit,
  favoriteCardsForUser,
  patchCardForUser,
  resolveCardIdForUserRequest,
} from "../raycast";

const runHandler = async (fn: any, ctx: any, args: any) => {
  const handler = (fn as any).handler ?? fn;
  return handler(ctx, args);
};

describe("raycast", () => {
  let originalLimit: any;

  beforeEach(async () => {
    const rateLimitsModule = await import("../shared/rateLimits");
    originalLimit = rateLimitsModule.rateLimiter.limit;
  });

  afterEach(async () => {
    const rateLimitsModule = await import("../shared/rateLimits");
    rateLimitsModule.rateLimiter.limit = originalLimit;
  });

  test("favorite search applies isFavorited filter in each search index", async () => {
    const isFavoritedFilters: string[] = [];
    const searchIndexes: string[] = [];

    const ctx = {
      db: {
        query: () => ({
          withSearchIndex: (indexName: string, cb: (q: any) => void) => {
            searchIndexes.push(indexName);
            const queryBuilder = {
              search: () => queryBuilder,
              eq: (field: string, value: unknown) => {
                if (field === "isFavorited" && value === true) {
                  isFavoritedFilters.push(indexName);
                }
                return queryBuilder;
              },
            };
            cb(queryBuilder);
            return {
              take: async () => [],
            };
          },
        }),
      },
    };

    const result = await runHandler(favoriteCardsForUser, ctx, {
      userId: "user_1",
      searchQuery: "design",
      limit: 50,
    });

    expect(result).toEqual([]);
    expect(searchIndexes.length).toBe(8);
    expect(isFavoritedFilters).toHaveLength(8);
    for (const indexName of searchIndexes) {
      expect(isFavoritedFilters).toContain(indexName);
    }
  });

  test("patchCardForUser forwards provided fields and returns updated card", async () => {
    const patchCalls: Record<string, unknown>[] = [];

    const ctx = {
      db: {
        get: async () => ({
          _id: "card_1",
          userId: "user_1",
          type: "text",
          content: "old",
        }),
        patch: async (_table: string, _id: string, payload: unknown) => {
          patchCalls.push(payload as Record<string, unknown>);
          return null;
        },
      },
      storage: {
        getUrl: async () => null,
      },
      scheduler: {
        runAfter: async () => null,
      },
    } as any;

    const result = await runHandler(patchCardForUser, ctx, {
      userId: "user_1",
      cardId: "card_1",
      notes: null,
      tags: [],
    });

    expect(result?._id).toBe("card_1");
    expect(result?.userId).toBe("user_1");
    expect(patchCalls.length).toBe(2);
  });

  test("patchCardForUser enqueues processing once for multi-field updates", async () => {
    const patchCalls: Record<string, unknown>[] = [];
    const runAfter = mock().mockResolvedValue(null);

    const ctx = {
      db: {
        get: async () => ({
          _id: "card_1",
          _creationTime: 1,
          userId: "user_1",
          type: "text",
          content: "old content",
          url: "https://old.example.com",
          createdAt: 1,
          updatedAt: 1,
        }),
        patch: async (_table: string, _id: string, payload: unknown) => {
          patchCalls.push(payload as Record<string, unknown>);
          return null;
        },
      },
      storage: {
        getUrl: async () => null,
      },
      scheduler: {
        runAfter,
      },
    } as any;

    await runHandler(patchCardForUser, ctx, {
      userId: "user_1",
      cardId: "card_1",
      content: "new content",
      url: "https://new.example.com",
    });

    expect(patchCalls.length).toBe(2);
    expect(runAfter).toHaveBeenCalledTimes(1);
  });

  test("resolveCardIdForUserRequest normalizes card id", async () => {
    const ctx = {
      db: {
        normalizeId: (_table: string, id: string) =>
          id === "valid" ? "card_1" : null,
      },
    } as any;

    expect(
      await runHandler(resolveCardIdForUserRequest, ctx, { cardId: "valid" })
    ).toBe("card_1");
    expect(
      await runHandler(resolveCardIdForUserRequest, ctx, { cardId: "invalid" })
    ).toBeNull();
  });

  test("checkApiRateLimit returns rate-limited result on contention errors", async () => {
    const rateLimitsModule = await import("../shared/rateLimits");
    rateLimitsModule.rateLimiter.limit = mock().mockRejectedValue(
      new Error(
        'Documents read from or written to the "rateLimits" table changed while this mutation was being run and on every subsequent retry.'
      )
    );

    const result = await runHandler(checkApiRateLimit, {} as any, {
      token: "teakapi_test",
    });

    expect(result.ok).toBe(false);
    expect(typeof result.retryAt).toBe("number");
  });
});
