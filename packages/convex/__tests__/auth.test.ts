// @ts-nocheck

import { beforeAll, describe, expect, it, mock } from "bun:test";
import { r2MockModuleFactory } from "./helpers/r2Mock.test-utils";

// Keep storage helpers isolated from the auth unit suite.
mock.module("../storage/r2", r2MockModuleFactory);

// We will dynamically import these
let ensureCardCreationAllowed: any;
let deleteAccountDataHandler: any;
let runAccountDataDeletion: any;
let getAccountCardDeletionBatchHandler: any;
let removeAccountCardUsageHandler: any;
let polar: any;
let rateLimiter: any;
let CARD_ERROR_CODES: any;
let FREE_TIER_LIMIT: any;

import { ConvexError } from "convex/values";
import { POLAR_PLAN_IDS } from "../shared/polarPlans";

const addUsageRecord = (
  ctx: any,
  activeCardCount: number,
  isCountExact = true
) => {
  const query = ctx.db.query.bind(ctx.db);
  ctx.db.query = (table: string) => {
    if (table !== "userCardUsage") {
      return query(table);
    }
    return {
      withIndex: (_name: string, callback: (builder: any) => void) => {
        const builder = { eq: () => builder };
        callback(builder);
        return {
          unique: async () => ({
            _id: "usage_1",
            activeCardCount,
            isCountExact,
            isSaturated: activeCardCount >= FREE_TIER_LIMIT,
          }),
        };
      },
    };
  };
  return ctx;
};

describe("auth", () => {
  beforeAll(async () => {
    const authModule = await import("../auth");
    const accountDeletionModule = await import("../accountDeletion");
    ensureCardCreationAllowed = authModule.ensureCardCreationAllowed;
    deleteAccountDataHandler = accountDeletionModule.deleteAccountDataHandler;
    runAccountDataDeletion = accountDeletionModule.runAccountDataDeletion;
    getAccountCardDeletionBatchHandler =
      accountDeletionModule.getAccountCardDeletionBatchHandler;
    removeAccountCardUsageHandler =
      accountDeletionModule.removeAccountCardUsageHandler;

    const constantsModule = await import("../shared/constants");
    CARD_ERROR_CODES = constantsModule.CARD_ERROR_CODES;
    FREE_TIER_LIMIT = constantsModule.FREE_TIER_LIMIT;

    const billingModule = await import("../billing");
    polar = billingModule.polar;

    const rateLimitsModule = await import("../shared/rateLimits");
    rateLimiter = rateLimitsModule.rateLimiter;
  });

  describe("ensureCardCreationAllowed", () => {
    const okRateLimiter = {
      limit: async () => ({ ok: true as const }),
    };
    const failRateLimiter = {
      limit: async () => ({ ok: false as const, retryAfter: 100 }),
    };

    it("throws if rate limited", async () => {
      const ctx = {} as any;
      try {
        await ensureCardCreationAllowed(ctx, "u1", {
          rateLimiter: failRateLimiter,
          getSubscription: async () => null,
        });
        throw new Error("Expected error");
      } catch (e: any) {
        expect(e).toBeInstanceOf(ConvexError);
        expect(e.data.code).toBe(CARD_ERROR_CODES.RATE_LIMITED);
      }
    });

    it("handles subscription check error gracefully", async () => {
      const ctx = {
        db: {
          query: (_table: string) => ({
            withIndex: (_name: any, cb: any) => {
              if (cb) {
                cb({
                  eq: () => ({
                    eq: () => {
                      // noop
                    },
                  }),
                });
              }
              return {
                take: async (limit: number) =>
                  Array.from({ length: Math.min(limit, FREE_TIER_LIMIT - 1) }),
              };
            },
          }),
        },
        runQuery: () => {
          throw new Error("runQuery should not be called");
        },
      } as any;

      addUsageRecord(ctx, FREE_TIER_LIMIT - 1);
      await ensureCardCreationAllowed(ctx, "u1", {
        rateLimiter: okRateLimiter,
        getSubscription: () => {
          throw new Error("Polar fail");
        },
      });
      // Should proceed to check card limit and succeed since count < limit
    });

    it("rejects free users at the limit and avoids ctx.runQuery", async () => {
      const ctx = {
        db: {
          query: (_table: string) => ({
            withIndex: (_name: any, cb: any) => {
              if (cb) {
                cb({
                  eq: () => ({
                    eq: () => {
                      // noop
                    },
                  }),
                });
              }
              return {
                take: async (limit: number) =>
                  Array.from({ length: Math.min(limit, FREE_TIER_LIMIT) }),
              };
            },
          }),
        },
        runQuery: () => {
          throw new Error("runQuery should not be called");
        },
      } as any;

      try {
        addUsageRecord(ctx, FREE_TIER_LIMIT);
        await ensureCardCreationAllowed(ctx, "user_1", {
          rateLimiter: okRateLimiter,
          getSubscription: async () => null,
        });
        throw new Error("Expected card limit error");
      } catch (error) {
        expect(error).toBeInstanceOf(ConvexError);
        expect((error as any).data?.code).toBe(
          CARD_ERROR_CODES.CARD_LIMIT_REACHED
        );
      }
    });

    it("allows free users below the limit without calling ctx.runQuery", async () => {
      const ctx = {
        db: {
          query: () => ({
            withIndex: (_name: any, cb: any) => {
              if (cb) {
                cb({
                  eq: () => ({
                    eq: () => {
                      // noop
                    },
                  }),
                });
              }
              return {
                take: async (limit: number) =>
                  Array.from({ length: Math.min(limit, FREE_TIER_LIMIT - 1) }),
              };
            },
          }),
        },
        runQuery: () => {
          throw new Error("runQuery should not be called");
        },
      } as any;

      addUsageRecord(ctx, FREE_TIER_LIMIT - 1);
      await ensureCardCreationAllowed(ctx, "user_2", {
        rateLimiter: okRateLimiter,
        getSubscription: async () => null,
      });
    });

    it("uses the bounded usage record instead of reading the cards range", async () => {
      const queriedTables: string[] = [];
      const ctx = {
        db: {
          query: (table: string) => {
            queriedTables.push(table);
            if (table === "cards") {
              throw new Error("broad cards range read");
            }
            return {
              withIndex: (_name: string, callback: (query: any) => void) => {
                const builder = {
                  eq: () => builder,
                };
                callback(builder);
                return {
                  unique: async () =>
                    table === "userCardUsage"
                      ? {
                          activeCardCount: 12,
                          isCountExact: true,
                        }
                      : null,
                };
              },
            };
          },
        },
      } as any;

      await ensureCardCreationAllowed(ctx, "user_bounded", {
        rateLimiter: okRateLimiter,
        getSubscription: async () => null,
      });

      expect(queriedTables).toEqual(["accountDeletionStates", "userCardUsage"]);
    });

    it("skips card counting for premium users", async () => {
      const queriedTables: string[] = [];
      const ctx = {
        db: {
          query: () => {
            return {
              withIndex: (_name: any, cb: any) => {
                if (cb) {
                  cb({
                    eq: () => ({
                      eq: () => {
                        // noop
                      },
                    }),
                  });
                }
                return {
                  collect: async () => [],
                  take: async () => [],
                };
              },
            };
          },
        },
        runQuery: () => {
          throw new Error("runQuery should not be called");
        },
      } as any;

      // At the free limit, so only the premium check lets this through.
      addUsageRecord(ctx, FREE_TIER_LIMIT);
      const query = ctx.db.query;
      ctx.db.query = (table: string) => {
        queriedTables.push(table);
        return query(table);
      };
      await ensureCardCreationAllowed(ctx, "user_3", {
        rateLimiter: okRateLimiter,
        getSubscription: async () => ({
          productId: POLAR_PLAN_IDS.production.monthly,
          status: "active",
        }),
      });

      expect(queriedTables).toContain("accountDeletionStates");
      expect(queriedTables).not.toContain("userCardUsage");
      expect(queriedTables).not.toContain("cards");
    });

    it("uses default dependencies when not provided", async () => {
      const originalLimit = rateLimiter.limit;
      const originalGetSubscription = polar.getCurrentSubscription;

      const mockLimit = mock().mockResolvedValue({ ok: true });
      const mockGetSub = mock().mockResolvedValue({
        productId: POLAR_PLAN_IDS.production.monthly,
        status: "active",
      });

      rateLimiter.limit = mockLimit;
      polar.getCurrentSubscription = mockGetSub;

      try {
        const ctx = { db: { query: () => null } } as any;
        addUsageRecord(ctx, 0);
        await ensureCardCreationAllowed(ctx, "u1");

        expect(mockLimit).toHaveBeenCalled();
        expect(mockGetSub).toHaveBeenCalled();
      } finally {
        rateLimiter.limit = originalLimit;
        polar.getCurrentSubscription = originalGetSubscription;
      }
    });
  });

  describe("deleteAccountData", () => {
    it("deletes bounded card and search rows", async () => {
      const ctx = {
        db: {
          get: mock((table: string, id: string) =>
            table === "cards" ? { _id: id, userId: "u1" } : null
          ),
          query: (table: string) => ({
            withIndex: (_name: any, cb: any) => {
              let _cardId: string | undefined;
              if (cb) {
                cb({
                  eq: (_field: string, value: string) => {
                    _cardId = value;
                  },
                });
              }
              return {
                ...(table === "cardSearchDocuments"
                  ? {
                      unique: async () => (cb ? { _id: "search_c1" } : null),
                    }
                  : {}),
                ...(table === "cardSearchTags"
                  ? {
                      take: async () => [{ _id: `tag_${_cardId}` }],
                    }
                  : {}),
                ...(table === "cardSearchTagSyncStates"
                  ? {
                      unique: async () => ({ _id: `tag_state_${_cardId}` }),
                    }
                  : {}),
              };
            },
          }),
          delete: mock(),
        },
      } as any;

      const result = await deleteAccountDataHandler(ctx, "u1", ["c1", "c2"]);

      expect(result).toBe(2);
      expect(ctx.db.delete).toHaveBeenCalledTimes(8);
    });

    it("does not read the cards table while deleting", async () => {
      // Regression: reading each card put the whole batch in the mutation's
      // optimistic-concurrency read set, so a concurrent card write (e.g.
      // updateCardAI) invalidated every retry until the batch failed the
      // account deletion. The handler must not read cards rows.
      const ctx = {
        db: {
          get: mock((table: string) => {
            if (table === "cards") {
              throw new Error("cards read would widen the OCC read set");
            }
            return null;
          }),
          query: (table: string) => ({
            withIndex: (_name: any, cb: any) => {
              let _cardId: string | undefined;
              if (cb) {
                cb({
                  eq: (_field: string, value: string) => {
                    _cardId = value;
                  },
                });
              }
              return {
                ...(table === "cardSearchDocuments"
                  ? { unique: async () => ({ _id: "search_c1" }) }
                  : {}),
                ...(table === "cardSearchTags"
                  ? { take: async () => [{ _id: `tag_${_cardId}` }] }
                  : {}),
                ...(table === "cardSearchTagSyncStates"
                  ? { unique: async () => ({ _id: `tag_state_${_cardId}` }) }
                  : {}),
              };
            },
          }),
          delete: mock(),
        },
      } as any;

      const result = await deleteAccountDataHandler(ctx, "u1", ["c1", "c2"]);

      expect(result).toBe(2);
      expect(ctx.db.get).not.toHaveBeenCalledWith("cards", "c1");
      expect(ctx.db.get).not.toHaveBeenCalledWith("cards", "c2");
      expect(ctx.db.delete).toHaveBeenCalledWith("cards", "c1");
      expect(ctx.db.delete).toHaveBeenCalledWith("cards", "c2");
    });

    it("skips cards already deleted by a concurrent batch", async () => {
      const ctx = {
        db: {
          get: mock(() => {
            throw new Error("cards read would widen the OCC read set");
          }),
          query: (table: string) => ({
            withIndex: (_name: any, cb: any) => {
              let _cardId: string | undefined;
              if (cb) {
                cb({
                  eq: (_field: string, value: string) => {
                    _cardId = value;
                  },
                });
              }
              return {
                ...(table === "cardSearchDocuments"
                  ? { unique: async () => null }
                  : {}),
                ...(table === "cardSearchTags" ? { take: async () => [] } : {}),
                ...(table === "cardSearchTagSyncStates"
                  ? { unique: async () => null }
                  : {}),
              };
            },
          }),
          delete: mock((table: string, id: string) => {
            if (table === "cards" && id === "c1") {
              throw new Error("Delete on non-existent doc");
            }
          }),
        },
      } as any;

      const result = await deleteAccountDataHandler(ctx, "u1", ["c1", "c2"]);

      expect(result).toBe(1);
      expect(ctx.db.delete).toHaveBeenCalledWith("cards", "c1");
      expect(ctx.db.delete).toHaveBeenCalledWith("cards", "c2");
    });

    it("skips the production nonexistent-document delete error", async () => {
      const ctx = {
        db: {
          get: mock(() => {
            throw new Error("cards read would widen the OCC read set");
          }),
          query: (table: string) => ({
            withIndex: (_name: any, cb: any) => {
              let _cardId: string | undefined;
              if (cb) {
                cb({
                  eq: (_field: string, value: string) => {
                    _cardId = value;
                  },
                });
              }
              return {
                ...(table === "cardSearchDocuments"
                  ? { unique: async () => null }
                  : {}),
                ...(table === "cardSearchTags" ? { take: async () => [] } : {}),
                ...(table === "cardSearchTagSyncStates"
                  ? { unique: async () => null }
                  : {}),
              };
            },
          }),
          delete: mock((table: string, id: string) => {
            if (table === "cards" && id === "c1") {
              // Verbatim production Convex backend wording (no hyphen).
              throw new Error('Delete on nonexistent document ID "c1"');
            }
          }),
        },
      } as any;

      const result = await deleteAccountDataHandler(ctx, "u1", ["c1", "c2"]);

      expect(result).toBe(1);
      expect(ctx.db.delete).toHaveBeenCalledWith("cards", "c1");
      expect(ctx.db.delete).toHaveBeenCalledWith("cards", "c2");
    });

    it("rethrows unexpected card deletion failures", async () => {
      const ctx = {
        db: {
          get: mock(() => null),
          query: (table: string) => ({
            withIndex: (_name: any, cb: any) => {
              if (cb) {
                cb({ eq: () => undefined });
              }
              return {
                ...(table === "cardSearchDocuments"
                  ? { unique: async () => null }
                  : {}),
                ...(table === "cardSearchTags" ? { take: async () => [] } : {}),
                ...(table === "cardSearchTagSyncStates"
                  ? { unique: async () => null }
                  : {}),
              };
            },
          }),
          delete: mock(() => {
            throw new Error("Connection lost to backend");
          }),
        },
      } as any;

      await expect(deleteAccountDataHandler(ctx, "u1", ["c1"])).rejects.toThrow(
        "Connection lost to backend"
      );
    });

    it("collects storage keys before deleting their owning rows", async () => {
      const ctx = {
        db: {
          query: () => ({
            withIndex: (_name: any, cb: any) => {
              if (cb) {
                cb({ eq: () => undefined });
              }
              return {
                take: async () => [
                  { _id: "c1", fileKey: "f1", thumbnailKey: "t1" },
                  { _id: "c2" },
                ],
              };
            },
          }),
        },
      } as any;

      const result = await getAccountCardDeletionBatchHandler(ctx, "u1");
      expect(result.cardIds).toEqual(["c1", "c2"]);
      expect(new Set(result.objectKeys)).toEqual(
        new Set(["f1", "f1.processing.json", "t1"])
      );
    });

    it("removes canonical card usage", async () => {
      const events: string[] = [];
      const ctx = {
        db: {
          query: (table: string) => ({
            withIndex: (_name: string, cb: any) => {
              let shard: number | undefined;
              const builder = {
                eq: (field: string, value: unknown) => {
                  if (field === "shard") {
                    shard = value as number;
                  }
                  return builder;
                },
              };
              cb(builder);
              return {
                unique: () => {
                  if (table === "userCardUsage") {
                    return Promise.resolve({ _id: "usage1" });
                  }
                  if (table === "userCardUsageShards" && shard !== undefined) {
                    return Promise.resolve({ _id: `shard${shard}` });
                  }
                  return Promise.resolve(null);
                },
              };
            },
          }),
          delete: mock((table: string, id: string) => {
            events.push(`${table}:${id}`);
          }),
        },
      } as any;

      await expect(
        removeAccountCardUsageHandler(ctx, "u1")
      ).resolves.toBeNull();
      expect(events).toEqual([
        ...Array.from(
          { length: 24 },
          (_, shard) => `userCardUsageShards:shard${shard}`
        ),
        "userCardUsage:usage1",
      ]);
    });

    it("awaits private object cleanup before deleting owning rows", async () => {
      const events: string[] = [];
      let mutationCount = 0;
      let queryCount = 0;
      const ctx = {
        runAction: mock((_ref: unknown, args: any) => {
          events.push(
            args.keys ? "delete-card-objects" : "delete-import-objects"
          );
          return args.keys ? { deleted: args.keys.length } : null;
        }),
        runMutation: mock((_ref: unknown, args: any) => {
          mutationCount += 1;
          if (mutationCount === 1) {
            events.push("begin-lock");
            return null;
          }
          if (args.cardIds) {
            events.push("delete-card-rows");
            return args.cardIds.length;
          }
          if (args.jobIds) {
            events.push("delete-import-rows");
          } else {
            events.push("delete-usage");
            return { deletedEntries: 0, hasMore: false };
          }
          return null;
        }),
        runQuery: mock((_ref: unknown, _args: any) => {
          queryCount += 1;
          if (queryCount === 1) {
            return { cardIds: ["c1"], objectKeys: ["users/u1/file"] };
          }
          if (queryCount === 2 || queryCount === 5) {
            return { cardIds: [], objectKeys: [] };
          }
          if (queryCount === 3) {
            return {
              itemIds: ["item1"],
              jobIds: ["job1"],
              objects: [{ sourceKey: "users/u1/import" }],
            };
          }
          return { itemIds: [], jobIds: [], objects: [] };
        }),
      } as any;

      await expect(
        runAccountDataDeletion(ctx, "u1", {
          deleteImportObjects: (objects: unknown[]) =>
            ctx.runAction("delete-import-objects", { objects }),
          observe: (_input: unknown, callback: () => Promise<unknown>) =>
            callback(),
        })
      ).resolves.toEqual({
        deletedCards: 1,
        deletedStorageObjectCount: 1,
      });
      expect(events).toEqual([
        "begin-lock",
        "delete-card-objects",
        "delete-card-rows",
        "delete-import-objects",
        "delete-import-rows",
        "delete-usage",
      ]);
    });

    it("propagates deletion failures", async () => {
      const ctx = {
        runAction: mock(() => null),
        runMutation: mock(() => {
          throw new Error("begin lock failed");
        }),
        runQuery: mock(() => ({ cardIds: [], objectKeys: [] })),
      } as any;

      const observe = mock(
        (_input: unknown, callback: () => Promise<unknown>) => callback()
      );

      await expect(
        runAccountDataDeletion(ctx, "u1", {
          deleteImportObjects: mock(),
          observe,
        })
      ).rejects.toThrow("begin lock failed");
      expect(observe).toHaveBeenCalledWith(
        {
          name: "auth.deleteAccountData",
          operation: "auth",
          surface: "backend",
          userId: "u1",
        },
        expect.any(Function)
      );
    });
  });
});
