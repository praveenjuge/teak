// @ts-nocheck

// Set environment variables BEFORE any imports that might load auth.ts
const _originalSiteUrl = process.env.SITE_URL;
const _originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
const _originalGoogleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const _originalAppleClientId = process.env.APPLE_CLIENT_ID;
const _originalAppleKeyId = process.env.APPLE_KEY_ID;
const _originalApplePrivateKey = process.env.APPLE_PRIVATE_KEY;
const _originalAppleTeamId = process.env.APPLE_TEAM_ID;

process.env.SITE_URL = "https://teakvault.com";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.APPLE_CLIENT_ID = "test-apple-client-id";
process.env.APPLE_KEY_ID = "test-apple-key-id";
process.env.APPLE_PRIVATE_KEY = TEST_APPLE_PRIVATE_KEY;
process.env.APPLE_TEAM_ID = "test-apple-team-id";

import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { TEST_APPLE_PRIVATE_KEY } from "../helpers/appleAuth.test-utils";
import { r2MockModuleFactory } from "../helpers/r2Mock.test-utils";

const mockSendEmail = mock().mockResolvedValue({ id: "m1" });

// Mock dependencies BEFORE importing auth.ts
mock.module("@convex-dev/resend", () => ({
  Resend: class {
    sendEmail = mockSendEmail;
  },
}));

mock.module("@convex-dev/better-auth/utils", () => ({
  requireActionCtx: (ctx: any) => ctx,
  isRunMutationCtx: () => true,
  isRunQueryCtx: () => true,
  isActionCtx: () => true,
}));

// Keep storage helpers isolated from the auth unit suite.
mock.module("../../storage/r2", r2MockModuleFactory);

// We will dynamically import these
let ensureCardCreationAllowed: any;
let getCurrentUserHandler: any;
let getAuthUserHandler: any;
let getCardCreationStatusHandler: any;
let deleteAccountDataHandler: any;
let deleteAccountData: any;
let getAccountCardDeletionBatchHandler: any;
let removeAccountCardUsageHandler: any;
let authComponent: any;
let createAuth: any;
let polar: any;
let rateLimiter: any;
let CARD_ERROR_CODES: any;
let FREE_TIER_LIMIT: any;

import { ConvexError } from "convex/values";
import { POLAR_PLAN_IDS } from "../../shared/polarPlans";

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
    const authModule = await import("../../auth");
    ensureCardCreationAllowed = authModule.ensureCardCreationAllowed;
    getCurrentUserHandler = authModule.getCurrentUserHandler;
    getAuthUserHandler = authModule.getAuthUserHandler;
    getCardCreationStatusHandler = authModule.getCardCreationStatusHandler;
    deleteAccountDataHandler = authModule.deleteAccountDataHandler;
    deleteAccountData = authModule.deleteAccountData;
    getAccountCardDeletionBatchHandler =
      authModule.getAccountCardDeletionBatchHandler;
    removeAccountCardUsageHandler = authModule.removeAccountCardUsageHandler;
    authComponent = authModule.authComponent;
    createAuth = authModule.createAuth;

    const constantsModule = await import("../../shared/constants");
    CARD_ERROR_CODES = constantsModule.CARD_ERROR_CODES;
    FREE_TIER_LIMIT = constantsModule.FREE_TIER_LIMIT;

    const billingModule = await import("../../billing");
    polar = billingModule.polar;

    const rateLimitsModule = await import("../../shared/rateLimits");
    rateLimiter = rateLimitsModule.rateLimiter;
  });

  beforeEach(() => {
    mockSendEmail.mockClear();
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
      let queryCalled = false;
      const ctx = {
        db: {
          query: () => {
            queryCalled = true;
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

      addUsageRecord(ctx, 0);
      await ensureCardCreationAllowed(ctx, "user_3", {
        rateLimiter: okRateLimiter,
        getSubscription: async () => ({
          productId: POLAR_PLAN_IDS.production.monthly,
          status: "active",
        }),
      });

      expect(queryCalled).toBe(true);
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

      const ctx = { db: { query: () => null } } as any;
      addUsageRecord(ctx, 0);
      await ensureCardCreationAllowed(ctx, "u1");

      expect(mockLimit).toHaveBeenCalled();
      expect(mockGetSub).toHaveBeenCalled();

      // Restore
      rateLimiter.limit = originalLimit;
      polar.getCurrentSubscription = originalGetSubscription;
    });
  });

  describe("getAuthUser", () => {
    const mockSafeGetAuthUser = mock();

    beforeEach(() => {
      authComponent.safeGetAuthUser = mockSafeGetAuthUser;
      mockSafeGetAuthUser.mockReset();
    });

    it("returns the user when authenticated", async () => {
      const user = { _id: "u1", email: "a@b.com" };
      mockSafeGetAuthUser.mockResolvedValue(user);
      const result = await getAuthUserHandler({} as any);
      expect(result).toEqual(user);
    });

    it("returns null when there is no session (does not throw)", async () => {
      mockSafeGetAuthUser.mockResolvedValue(undefined);
      const result = await getAuthUserHandler({} as any);
      expect(result).toBeNull();
    });

    it("returns null instead of throwing when the lookup errors", async () => {
      // Regression guard for the production sign-out crash: the provider-level
      // subscription re-runs against a just-cleared session, and a thrown
      // result there crashed the page (Minified React error #310). The query
      // must swallow the error and resolve to null instead of rejecting.
      mockSafeGetAuthUser.mockRejectedValue(new ConvexError("Unauthenticated"));
      const result = await getAuthUserHandler({} as any);
      expect(result).toBeNull();
    });
  });

  describe("getCurrentUser", () => {
    const mockGetAuthUser = mock();
    const mockGetCurrentSubscription = mock();

    beforeEach(() => {
      authComponent.getAuthUser = mockGetAuthUser;
      polar.getCurrentSubscription = mockGetCurrentSubscription;
      mockGetAuthUser.mockReset();
      mockGetCurrentSubscription.mockReset();
    });

    it("returns null if not authenticated", async () => {
      mockGetAuthUser.mockResolvedValue(null);
      const ctx = {} as any;
      const result = await getCurrentUserHandler(ctx);
      expect(result).toBeNull();
    });

    it("handles Unauthenticated error as null", async () => {
      mockGetAuthUser.mockRejectedValue(new Error("Unauthenticated"));
      const ctx = {} as any;
      const result = await getCurrentUserHandler(ctx);
      expect(result).toBeNull();
    });

    it("re-throws other errors", () => {
      mockGetAuthUser.mockRejectedValue(new Error("Other error"));
      const ctx = {} as any;
      expect(getCurrentUserHandler(ctx)).rejects.toThrow("Other error");
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
      const result = await getCurrentUserHandler(ctx);
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
      const result = await getCurrentUserHandler(ctx);
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
      const result = await getCurrentUserHandler(ctx);
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
      const result = await getCurrentUserHandler(ctx);
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
      const result = await getCurrentUserHandler(ctx);
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
      const result = await getCardCreationStatusHandler(ctx);
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
      const result = await getCardCreationStatusHandler(ctx);
      expect(take).toHaveBeenCalledWith(FREE_TIER_LIMIT);
      expect(result).toEqual({
        hasPremium: false,
        canCreateCard: false,
      });
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
              let cardId: string | undefined;
              if (cb) {
                cb({
                  eq: (_field: string, value: string) => {
                    cardId = value;
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
                      take: async () => [{ _id: `tag_${cardId}` }],
                    }
                  : {}),
                ...(table === "cardSearchTagSyncStates"
                  ? {
                      unique: async () => ({ _id: `tag_state_${cardId}` }),
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

      const handler = deleteAccountData.handler ?? deleteAccountData;
      await expect(handler(ctx, { userId: "u1" })).resolves.toEqual({
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
  });

  describe("createAuth", () => {
    it("returns betterAuth instance and covers callbacks", async () => {
      const originalSiteUrl = process.env.SITE_URL;
      const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
      const originalGoogleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const originalAppleClientId = process.env.APPLE_CLIENT_ID;
      const originalAppleKeyId = process.env.APPLE_KEY_ID;
      const originalApplePrivateKey = process.env.APPLE_PRIVATE_KEY;
      const originalAppleTeamId = process.env.APPLE_TEAM_ID;

      try {
        const ctx = {
          runAction: mock(),
          runQuery: mock(),
          runMutation: mock(),
        } as any;
        const auth = createAuth(ctx) as any;
        expect(auth).toBeDefined();

        // Test development origins branch
        const originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "development";
        const authDev = createAuth(ctx) as any;
        expect(Array.isArray(authDev.options.trustedOrigins)).toBe(true);
        expect(authDev.options.trustedOrigins).toContain(
          "https://app.teakvault.com"
        );
        process.env.NODE_ENV = originalNodeEnv;

        // Test callbacks
        // We need to mock resend.sendEmail which is used in callbacks
        // But it's a global export in auth.ts.
        // Actually BetterAuth might hide these in its internal structure.
        // Let's check where they are: auth.options.emailAndPassword.sendResetPassword
        const options = auth.options;
        expect(options.emailAndPassword?.sendResetPassword).toBeFunction();
        expect(options.emailVerification?.sendVerificationEmail).toBeFunction();
        await options.user.deleteUser.beforeDelete({ id: "u1" });
        expect(ctx.runAction).toHaveBeenCalledWith(expect.anything(), {
          userId: "u1",
        });

        const originalBackendDsn = process.env.SENTRY_BACKEND_DSN;
        const originalConsoleError = console.error;
        const consoleError = mock();
        const scheduler = { runAfter: mock().mockResolvedValue(null) };
        try {
          process.env.SENTRY_BACKEND_DSN = "";
          console.error = consoleError;
          const authWithScheduler = createAuth({ ...ctx, scheduler }) as any;
          authWithScheduler.options.onAPIError.onError(
            new Error("Invalid session")
          );
          expect(consoleError).toHaveBeenCalledWith("[auth] Request failed", {
            errorClass: "AuthError",
          });
          expect(scheduler.runAfter).toHaveBeenCalledWith(
            0,
            expect.anything(),
            expect.objectContaining({
              errorClass: "AuthError",
              outcome: "failure",
              stage: "sign_in",
            })
          );

          process.env.SENTRY_BACKEND_DSN = "https://public@example.invalid/1";
          consoleError.mockClear();
          scheduler.runAfter.mockRejectedValueOnce(
            new Error("Scheduler unavailable")
          );
          authWithScheduler.options.onAPIError.onError(
            new Error("Invalid session")
          );
          await new Promise((resolve) => setTimeout(resolve, 0));
          expect(consoleError).toHaveBeenCalledWith("[auth] Request failed", {
            errorClass: "AuthError",
          });
        } finally {
          if (originalBackendDsn === undefined) {
            delete process.env.SENTRY_BACKEND_DSN;
          } else {
            process.env.SENTRY_BACKEND_DSN = originalBackendDsn;
          }
          console.error = originalConsoleError;
        }
      } finally {
        process.env.SITE_URL = originalSiteUrl;
        process.env.GOOGLE_CLIENT_ID = originalGoogleClientId;
        process.env.GOOGLE_CLIENT_SECRET = originalGoogleClientSecret;
        process.env.APPLE_CLIENT_ID = originalAppleClientId;
        process.env.APPLE_KEY_ID = originalAppleKeyId;
        process.env.APPLE_PRIVATE_KEY = originalApplePrivateKey;
        process.env.APPLE_TEAM_ID = originalAppleTeamId;
      }
    });
  });
});
