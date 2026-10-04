// @ts-nocheck
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { ConvexError } from "convex/values";
import {
  getAuthUserHandler,
  getCardCreationStatusHandler,
  getCurrentUserHandler,
} from "../auth";
import { polar } from "../billing";
import { FREE_TIER_LIMIT } from "../shared/constants";
import { POLAR_PLAN_IDS } from "../shared/polarPlans";
import { withTestSession } from "./helpers/session.test-utils";

// Fixtures for the real identity/session boundary; only provider data is mocked.
const withProfileSession = (ctx: any, readUser: () => Promise<any>) =>
  withTestSession({
    ...ctx,
    auth: {
      getUserIdentity: async () => {
        const user = await readUser();
        return user ? { subject: user._id ?? user.subject } : null;
      },
    },
    runQuery: async (ref: any, args: any) =>
      args?.model === "user" ? readUser() : ctx.runQuery?.(ref, args),
  });

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

describe("auth profile", () => {
  describe("getAuthUser", () => {
    const mockSafeGetAuthUser = mock();

    beforeEach(() => {
      mockSafeGetAuthUser.mockReset();
    });

    it("returns the user when authenticated", async () => {
      const user = { _id: "u1", email: "a@b.com" };
      mockSafeGetAuthUser.mockResolvedValue(user);
      const result = await getAuthUserHandler(
        withProfileSession({}, mockSafeGetAuthUser)
      );
      expect(result).toEqual(user);
    });

    it("returns null when there is no session (does not throw)", async () => {
      mockSafeGetAuthUser.mockResolvedValue(undefined);
      const result = await getAuthUserHandler(
        withProfileSession({}, mockSafeGetAuthUser)
      );
      expect(result).toBeNull();
    });

    it("returns null instead of throwing when the lookup errors", async () => {
      // Regression guard for the production sign-out crash: the provider-level
      // subscription re-runs against a just-cleared session, and a thrown
      // result there crashed the page (Minified React error #310). The query
      // must swallow the error and resolve to null instead of rejecting.
      mockSafeGetAuthUser.mockRejectedValue(
        new ConvexError("Profile lookup failed")
      );
      const result = await getAuthUserHandler(
        withProfileSession({}, mockSafeGetAuthUser)
      );
      expect(result).toBeNull();
    });
  });

  describe("getCurrentUser", () => {
    const mockGetAuthUser = mock();
    const mockGetCurrentSubscription = mock();

    beforeEach(() => {
      polar.getCurrentSubscription = mockGetCurrentSubscription;
      mockGetAuthUser.mockReset();
      mockGetCurrentSubscription.mockReset();
    });

    it("returns null if not authenticated", async () => {
      mockGetAuthUser.mockResolvedValue(null);
      const ctx = {} as any;
      const result = await getCurrentUserHandler(
        withProfileSession(ctx, mockGetAuthUser)
      );
      expect(result).toBeNull();
    });

    it("handles Unauthenticated error as null", async () => {
      mockGetAuthUser.mockRejectedValue(new Error("Unauthenticated"));
      const ctx = {} as any;
      const result = await getCurrentUserHandler(
        withProfileSession(ctx, mockGetAuthUser)
      );
      expect(result).toBeNull();
    });

    it("re-throws other errors", async () => {
      mockGetAuthUser.mockRejectedValue(new Error("Other error"));
      const ctx = {} as any;
      await expect(
        getCurrentUserHandler(withProfileSession(ctx, mockGetAuthUser))
      ).rejects.toThrow("Other error");
    });

    it("handles subscription check error", async () => {
      const user = { subject: "u1" };
      mockGetAuthUser.mockResolvedValue(user);
      mockGetCurrentSubscription.mockRejectedValue(new Error("Polar error"));

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
                collect: async () => [],
                take: async () => [],
              };
            },
          }),
        },
      } as any;

      addUsageRecord(ctx, 0);
      const result = await getCurrentUserHandler(
        withProfileSession(ctx, mockGetAuthUser)
      );
      expect(result).not.toBeNull();
      expect(result!.hasPremium).toBe(false);
    });

    it("returns user info with free tier status", async () => {
      const user = { subject: "u1" };
      mockGetAuthUser.mockResolvedValue(user);
      mockGetCurrentSubscription.mockResolvedValue(null);

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
                collect: async () => [],
                take: async () => [],
              };
            },
          }),
        },
      } as any;

      addUsageRecord(ctx, 0);
      const result = await getCurrentUserHandler(
        withProfileSession(ctx, mockGetAuthUser)
      );
      expect(result).toEqual({
        ...user,
        hasPremium: false,
        cardCount: 0,
        canCreateCard: true,
      });
    });

    it("returns user info with premium status", async () => {
      const user = { subject: "u1" };
      mockGetAuthUser.mockResolvedValue(user);
      mockGetCurrentSubscription.mockResolvedValue({
        productId: POLAR_PLAN_IDS.production.monthly,
        status: "active",
      });

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
                collect: async () => Array.from({ length: 100 }),
                take: async (limit: number) =>
                  Array.from({ length: Math.min(limit, 100) }),
              };
            },
          }),
        },
      } as any;

      addUsageRecord(ctx, 3);
      const result = await getCurrentUserHandler(
        withProfileSession(ctx, mockGetAuthUser)
      );
      expect(result).not.toBeNull();
      expect(result!.hasPremium).toBe(true);
      expect(result!.canCreateCard).toBe(true);
      expect(result!.cardCount).toBe(3);
    });

    it("bounds premium card counting while usage backfill is incomplete", async () => {
      const user = { subject: "u1" };
      mockGetAuthUser.mockResolvedValue(user);
      mockGetCurrentSubscription.mockResolvedValue({
        productId: POLAR_PLAN_IDS.production.monthly,
        status: "active",
      });

      const take = mock(async (limit: number) => Array.from({ length: limit }));
      const ctx = {
        db: {
          query: () => ({
            withIndex: (_name: any, cb: any) => {
              cb?.({
                eq: () => ({
                  eq: () => undefined,
                }),
              });
              return { take };
            },
          }),
        },
      } as any;

      addUsageRecord(ctx, 0, false);
      const result = await getCurrentUserHandler(
        withProfileSession(ctx, mockGetAuthUser)
      );
      expect(take).toHaveBeenCalledWith(FREE_TIER_LIMIT + 1);
      expect(result).toMatchObject({
        hasPremium: true,
        cardCount: FREE_TIER_LIMIT + 1,
        canCreateCard: true,
      });
    });

    it("does not grant premium for an unapproved Polar product", async () => {
      const user = { subject: "u1" };
      mockGetAuthUser.mockResolvedValue(user);
      mockGetCurrentSubscription.mockResolvedValue({
        productId: "prod_attacker",
        status: "active",
      });

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
                collect: async () => Array.from({ length: 100 }),
                take: async (limit: number) =>
                  Array.from({ length: Math.min(limit, 3) }),
              };
            },
          }),
        },
      } as any;

      addUsageRecord(ctx, 3);
      const result = await getCurrentUserHandler(
        withProfileSession(ctx, mockGetAuthUser)
      );
      expect(result!.hasPremium).toBe(false);
    });

    it("returns lightweight card creation status for AddCardForm gating", async () => {
      const user = { subject: "u1" };
      mockGetAuthUser.mockResolvedValue(user);
      mockGetCurrentSubscription.mockResolvedValue(null);

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
                  Array.from({ length: Math.min(limit, FREE_TIER_LIMIT) }),
              };
            },
          }),
        },
      } as any;

      addUsageRecord(ctx, FREE_TIER_LIMIT);
      const result = await getCardCreationStatusHandler(
        withProfileSession(ctx, mockGetAuthUser)
      );
      expect(result).toEqual({
        hasPremium: false,
        canCreateCard: false,
      });
    });

    it("ignores partial usage while gating free-tier card creation", async () => {
      const user = { subject: "u1" };
      mockGetAuthUser.mockResolvedValue(user);
      mockGetCurrentSubscription.mockResolvedValue(null);

      const take = mock(async () => Array.from({ length: FREE_TIER_LIMIT }));
      const ctx = {
        db: {
          query: () => ({
            withIndex: (_name: any, cb: any) => {
              cb?.({
                eq: () => ({
                  eq: () => undefined,
                }),
              });
              return { take };
            },
          }),
        },
      } as any;

      addUsageRecord(ctx, 0, false);
      const result = await getCardCreationStatusHandler(
        withProfileSession(ctx, mockGetAuthUser)
      );
      expect(take).toHaveBeenCalledWith(FREE_TIER_LIMIT + 1);
      expect(result).toEqual({
        hasPremium: false,
        canCreateCard: false,
      });
    });
  });
});
