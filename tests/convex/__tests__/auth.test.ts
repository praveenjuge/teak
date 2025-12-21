// @ts-nocheck
import { describe, expect, it, mock, beforeEach, beforeAll } from "bun:test";

const mockSendEmail = mock().mockResolvedValue({ id: "m1" });

// Mock dependencies BEFORE importing auth.ts
mock.module("@convex-dev/resend", () => ({
    Resend: class {
        sendEmail = mockSendEmail;
    }
}));



mock.module("@convex-dev/better-auth/utils", () => ({
    requireActionCtx: (ctx: any) => ctx,
    isRunMutationCtx: () => true,
    isRunQueryCtx: () => true,
    isActionCtx: () => true,
}));

// We will dynamically import these
let ensureCardCreationAllowed: any;
let getCurrentUserHandler: any;
let deleteAccountHandler: any;
let authComponent: any;
let createAuth: any;
let polar: any;
let rateLimiter: any;
let CARD_ERROR_CODES: any;
let FREE_TIER_LIMIT: any;

import { ConvexError } from "convex/values";

describe("auth", () => {
    beforeAll(async () => {
        const authModule = await import("../../../convex/auth");
        ensureCardCreationAllowed = authModule.ensureCardCreationAllowed;
        getCurrentUserHandler = authModule.getCurrentUserHandler;
        deleteAccountHandler = authModule.deleteAccountHandler;
        authComponent = authModule.authComponent;
        createAuth = authModule.createAuth;

        const constantsModule = await import("../../../convex/shared/constants");
        CARD_ERROR_CODES = constantsModule.CARD_ERROR_CODES;
        FREE_TIER_LIMIT = constantsModule.FREE_TIER_LIMIT;

        const billingModule = await import("../../../convex/billing");
        polar = billingModule.polar;

        const rateLimitsModule = await import("../../../convex/shared/rateLimits");
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
                        withIndex: (name: any, cb: any) => {
                            if (cb) cb({ eq: () => ({ eq: () => { } }) });
                            return { collect: async () => Array.from({ length: FREE_TIER_LIMIT - 1 }) };
                        },
                    }),
                },
                runQuery: () => {
                    throw new Error("runQuery should not be called");
                },
            } as any;

            await ensureCardCreationAllowed(ctx, "u1", {
                rateLimiter: okRateLimiter,
                getSubscription: async () => { throw new Error("Polar fail"); },
            });
            // Should proceed to check card limit and succeed since count < limit
        });

        it("rejects free users at the limit and avoids ctx.runQuery", async () => {
            const ctx = {
                db: {
                    query: () => ({
                        withIndex: (name: any, cb: any) => {
                            if (cb) cb({ eq: () => ({ eq: () => { } }) });
                            return { collect: async () => Array.from({ length: FREE_TIER_LIMIT }) };
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
                    CARD_ERROR_CODES.CARD_LIMIT_REACHED,
                );
            }
        });

        it("allows free users below the limit without calling ctx.runQuery", async () => {
            const ctx = {
                db: {
                    query: () => ({
                        withIndex: (name: any, cb: any) => {
                            if (cb) cb({ eq: () => ({ eq: () => { } }) });
                            return { collect: async () => Array.from({ length: FREE_TIER_LIMIT - 1 }) };
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
                            withIndex: (name: any, cb: any) => {
                                if (cb) cb({ eq: () => ({ eq: () => { } }) });
                                return { collect: async () => [] };
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

        it("re-throws other errors", async () => {
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
                        withIndex: (name: any, cb: any) => {
                            if (cb) cb({ eq: () => ({ eq: () => { } }) });
                            return { collect: async () => [] };
                        }
                    })
                }
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
                        withIndex: (name: any, cb: any) => {
                            if (cb) cb({ eq: () => ({ eq: () => { } }) });
                            return { collect: async () => [] };
                        },
                    })
                }
            } as any;

            const result = await getCurrentUserHandler(ctx);
            expect(result).toEqual({
                ...user,
                hasPremium: false,
                cardCount: 0,
                canCreateCard: true
            });
        });

        it("returns user info with premium status", async () => {
            const user = { subject: "u1" };
            mockGetAuthUser.mockResolvedValue(user);
            mockGetCurrentSubscription.mockResolvedValue({ status: "active" });

            const ctx = {
                db: {
                    query: () => ({
                        withIndex: (name: any, cb: any) => {
                            if (cb) cb({ eq: () => ({ eq: () => { } }) });
                            return { collect: async () => Array.from({ length: 100 }) };
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
    });

    describe("deleteAccount", () => {
        it("throws if not authenticated", async () => {
            const ctx = { auth: { getUserIdentity: mock().mockResolvedValue(null) } } as any;
            expect(deleteAccountHandler(ctx)).rejects.toThrow("User must be authenticated");
        });

        it("deletes cards and files", async () => {
            const ctx = {
                auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
                db: {
                    query: () => ({
                        withIndex: (name: any, cb: any) => {
                            if (cb) cb({ eq: () => { } });
                            return {
                                collect: async () => [
                                    { _id: "c1", fileId: "f1", thumbnailId: "t1" },
                                    { _id: "c2" }
                                ]
                            };
                        }
                    }),
                    delete: mock(),
                },
                storage: { delete: mock() }
            } as any;

            const result = await deleteAccountHandler(ctx);

            expect(result.deletedCards).toBe(2);
            expect(ctx.storage.delete).toHaveBeenCalledWith("f1");
            expect(ctx.storage.delete).toHaveBeenCalledWith("t1");
            expect(ctx.db.delete).toHaveBeenCalledTimes(2);
        });
    });

    describe("createAuth", () => {
        it("returns betterAuth instance and covers callbacks", async () => {
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
            expect(authDev.options.trustedOrigins).toContain("exp://localhost:*/*");
            process.env.NODE_ENV = originalNodeEnv;

            // Test callbacks
            const user = { email: "test@example.com" };
            const url = "https://example.com";

            // We need to mock resend.sendEmail which is used in callbacks
            // But it's a global export in auth.ts.
            // Actually BetterAuth might hide these in its internal structure.
            // Let's check where they are: auth.options.emailAndPassword.sendResetPassword
            const options = auth.options;
            if (options.emailAndPassword?.sendResetPassword) {
                await options.emailAndPassword.sendResetPassword({ user, url });
            }
            if (options.emailVerification?.sendVerificationEmail) {
                await options.emailVerification.sendVerificationEmail({ user, url });
            }
        });
    });
});

