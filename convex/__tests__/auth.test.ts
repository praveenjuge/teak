import { describe, expect, it } from "bun:test";
import { ConvexError } from "convex/values";
import {
  ensureCardCreationAllowed,
} from "../auth";
import {
  CARD_ERROR_CODES,
  FREE_TIER_LIMIT,
} from "../shared/constants";

describe("ensureCardCreationAllowed", () => {
  const okRateLimiter = {
    limit: async () => ({ ok: true as const }),
  };

  it("rejects free users at the limit and avoids ctx.runQuery", async () => {
    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            collect: async () => Array.from({ length: FREE_TIER_LIMIT }),
          }),
        }),
      },
      runQuery: () => {
        throw new Error("runQuery should not be called");
      },
    } as any;

    try {
      await ensureCardCreationAllowed(ctx, "user_1", {
        rateLimiter: okRateLimiter,
        getSubscription: async () => null,
      });
      throw new Error("Expected card limit error");
    } catch (error) {
      expect(error).toBeInstanceOf(ConvexError);
      expect((error as any).data?.code).toBe(
        CARD_ERROR_CODES.CARD_LIMIT_REACHED,
      );
    }
  });

  it("allows free users below the limit without calling ctx.runQuery", async () => {
    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            collect: async () => Array.from({ length: FREE_TIER_LIMIT - 1 }),
          }),
        }),
      },
      runQuery: () => {
        throw new Error("runQuery should not be called");
      },
    } as any;

    await ensureCardCreationAllowed(ctx, "user_2", {
      rateLimiter: okRateLimiter,
      getSubscription: async () => null,
    });
  });

  it("skips card counting for premium users", async () => {
    let queryCalled = false;
    const ctx = {
      db: {
        query: () => {
          queryCalled = true;
          return {
            withIndex: () => ({
              collect: async () => [],
            }),
          };
        },
      },
      runQuery: () => {
        throw new Error("runQuery should not be called");
      },
    } as any;

    await ensureCardCreationAllowed(ctx, "user_3", {
      rateLimiter: okRateLimiter,
      getSubscription: async () => ({ status: "active" }),
    });

    expect(queryCalled).toBe(false);
  });
});
