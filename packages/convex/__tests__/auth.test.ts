import { beforeAll, describe, expect, it, mock } from "bun:test";
import { noop } from "./helpers/convex.test-utils";
import {
  objectDeletionMockModuleFactory,
  r2MockModuleFactory,
} from "./helpers/r2Mock.test-utils";

mock.module("../storage/r2", r2MockModuleFactory);
mock.module("../storage/objectDeletion", objectDeletionMockModuleFactory);

let authorizeCardCreation: any;
let ensureCardQuotaAvailable: any;
let removeAccountCardUsageHandler: any;
let polar: any;
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
    const quotaModule = await import("../card/quota");
    const accountDeletionModule = await import("../accountDeletion");
    authorizeCardCreation = quotaModule.authorizeCardCreation;
    ensureCardQuotaAvailable = quotaModule.ensureCardQuotaAvailable;
    removeAccountCardUsageHandler =
      accountDeletionModule.removeAccountCardUsageHandler;

    const constantsModule = await import("../shared/constants");
    CARD_ERROR_CODES = constantsModule.CARD_ERROR_CODES;
    FREE_TIER_LIMIT = constantsModule.FREE_TIER_LIMIT;

    const billingModule = await import("../billing/polar");
    polar = billingModule.polar;
  });

  describe("authorizeCardCreation", () => {
    it("throws if rate limited", async () => {
      const error = await authorizeCardCreation({} as any, "u1", {
        rateLimiter: {
          limit: async () => ({ ok: false as const, retryAfter: 100 }),
        },
        getSubscription: async () => null,
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConvexError);
      expect((error as any).data.code).toBe(CARD_ERROR_CODES.RATE_LIMITED);
    });
  });

  describe("ensureCardQuotaAvailable", () => {
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

      await ensureCardQuotaAvailable(ctx, "user_bounded", {
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
      await ensureCardQuotaAvailable(ctx, "user_3", {
        getSubscription: async () => ({
          productId: POLAR_PLAN_IDS.production.monthly,
          status: "active",
        }),
      });

      expect(queriedTables).toContain("accountDeletionStates");
      expect(queriedTables).not.toContain("userCardUsage");
      expect(queriedTables).not.toContain("cards");
    });

    it("reads the plan from Polar when no lookup is given", async () => {
      const originalGetSubscription = polar.getCurrentSubscription;
      polar.getCurrentSubscription = mock().mockResolvedValue({
        productId: POLAR_PLAN_IDS.production.monthly,
        status: "active",
      });

      try {
        const ctx = {
          db: {
            query: () => ({
              withIndex: () => ({ unique: async () => null }),
            }),
          },
        } as any;
        addUsageRecord(ctx, FREE_TIER_LIMIT);
        await expect(
          ensureCardQuotaAvailable(ctx, "u1")
        ).resolves.toBeUndefined();
      } finally {
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
