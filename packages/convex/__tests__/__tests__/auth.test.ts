// @ts-nocheck

// Set environment variables BEFORE any imports that might load auth.ts
const _originalSiteUrl = process.env.SITE_URL;
const _originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
const _originalGoogleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const _originalAppleClientId = process.env.APPLE_CLIENT_ID;
const _originalAppleClientSecret = process.env.APPLE_CLIENT_SECRET;

process.env.SITE_URL = "https://teakvault.com";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.APPLE_CLIENT_ID = "test-apple-client-id";
process.env.APPLE_CLIENT_SECRET = "test-apple-client-secret";

import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { r2MockModuleFactory, r2Mocks } from "../helpers/r2Mock.test-utils";

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

// Mock the R2 storage helpers used by auth.deleteAccountDataHandler so we can
// assert deletions without standing up an actual R2 client.
mock.module("../../storage/r2", r2MockModuleFactory);

// We will dynamically import these
let ensureCardCreationAllowed: any;
let getCurrentUserHandler: any;
let getAuthUserHandler: any;
let getCardCreationStatusHandler: any;
let deleteAccountDataHandler: any;
let authComponent: any;
let createAuth: any;
let polar: any;
let rateLimiter: any;
let CARD_ERROR_CODES: any;
let FREE_TIER_LIMIT: any;

import { ConvexError } from "convex/values";

describe("auth", () => {
  beforeAll(async () => {
    const authModule = await import("../../auth");
    ensureCardCreationAllowed = authModule.ensureCardCreationAllowed;
    getCurrentUserHandler = authModule.getCurrentUserHandler;
    getAuthUserHandler = authModule.getAuthUserHandler;
    getCardCreationStatusHandler = authModule.getCardCreationStatusHandler;
    deleteAccountDataHandler = authModule.deleteAccountDataHandler;
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

      await ensureCardCreationAllowed(ctx, "user_3", {
        rateLimiter: okRateLimiter,
        getSubscription: async () => ({ status: "active" }),
      });

      expect(queryCalled).toBe(false);
    });

    it("uses default dependencies when not provided", async () => {
      const originalLimit = rateLimiter.limit;
      const originalGetSubscription = polar.getCurrentSubscription;

      const mockLimit = mock().mockResolvedValue({ ok: true });
      const mockGetSub = mock().mockResolvedValue({ status: "active" });

      rateLimiter.limit = mockLimit;
      polar.getCurrentSubscription = mockGetSub;

      const ctx = {} as any;
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
      mockGetCurrentSubscription.mockResolvedValue({ status: "active" });

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

      const result = await getCurrentUserHandler(ctx);
      expect(result).not.toBeNull();
      expect(result!.hasPremium).toBe(true);
      expect(result!.canCreateCard).toBe(true);
      expect(result!.cardCount).toBe(100);
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

      const result = await getCardCreationStatusHandler(ctx);
      expect(result).toEqual({
        hasPremium: false,
        canCreateCard: false,
      });
    });
  });

  describe("deleteAccountData", () => {
    it("deletes cards and files", async () => {
      r2Mocks.deleteObject.mockClear();

      const ctx = {
        db: {
          query: () => ({
            withIndex: (_name: any, cb: any) => {
              if (cb) {
                cb({
                  eq: () => {
                    // noop
                  },
                });
              }
              return {
                collect: async () => [
                  { _id: "c1", fileKey: "f1", thumbnailKey: "t1" },
                  { _id: "c2" },
                ],
              };
            },
          }),
          delete: mock(),
        },
      } as any;

      const result = await deleteAccountDataHandler(ctx, "u1");

      expect(result.deletedCards).toBe(2);
      expect(result.deletedStorageObjectCount).toBe(2);
      expect(r2Mocks.deleteObject).toHaveBeenCalledWith(ctx, "f1");
      expect(r2Mocks.deleteObject).toHaveBeenCalledWith(ctx, "t1");
      expect(ctx.db.delete).toHaveBeenCalledTimes(2);
    });
  });

  describe("createAuth", () => {
    it("returns betterAuth instance and covers callbacks", async () => {
      const originalSiteUrl = process.env.SITE_URL;
      const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
      const originalGoogleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const originalAppleClientId = process.env.APPLE_CLIENT_ID;
      const originalAppleClientSecret = process.env.APPLE_CLIENT_SECRET;

      try {
        const ctx = {
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
        expect(ctx.runMutation).toHaveBeenCalledWith(expect.anything(), {
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
        process.env.APPLE_CLIENT_SECRET = originalAppleClientSecret;
      }
    });
  });
});
