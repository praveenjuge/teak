import { beforeAll, describe, expect, it, mock } from "bun:test";
import { noop } from "./helpers/convex.test-utils";
import {
  objectDeletionMockModuleFactory,
  r2MockModuleFactory,
} from "./helpers/r2Mock.test-utils";

mock.module("../storage/r2", r2MockModuleFactory);
mock.module("../storage/objectDeletion", objectDeletionMockModuleFactory);

let ensureCardCreationAllowed: any;
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
    removeAccountCardUsageHandler =
      accountDeletionModule.removeAccountCardUsageHandler;

    const constantsModule = await import("../shared/constants");
    CARD_ERROR_CODES = constantsModule.CARD_ERROR_CODES;
    FREE_TIER_LIMIT = constantsModule.FREE_TIER_LIMIT;

    const billingModule = await import("../billing/polar");
    polar = billingModule.polar;

    const rateLimitsModule = await import("../rateLimiter");
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
                    eq: noop,
                  }),
                });
              }
              return {
                unique: async () => null,
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
    });

    it("rejects free users at the limit and avoids ctx.runQuery", async () => {
      const ctx = {
        db: {
          query: (_table: string) => ({
            withIndex: (_name: any, cb: any) => {
              if (cb) {
                cb({
                  eq: () => ({
                    eq: noop,
                  }),
                });
              }
              return {
                unique: async () => null,
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
                    eq: noop,
                  }),
                });
              }
              return {
                unique: async () => null,
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
          query: () => ({
            withIndex: (_name: any, cb: any) => {
              if (cb) {
                cb({
                  eq: () => ({
                    eq: noop,
                  }),
                });
              }
              return {
                collect: async () => [],
                take: async () => [],
                unique: async () => null,
              };
            },
          }),
        },
        runQuery: () => {
          throw new Error("runQuery should not be called");
        },
      } as any;

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
        const ctx = {
          db: {
            query: () => ({
              withIndex: () => ({ unique: async () => null }),
            }),
          },
        } as any;
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

  describe("removeAccountCardUsage", () => {
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
  });
});
