
import { describe, expect, it, mock, beforeEach } from "bun:test";
import { ConvexError } from "convex/values";
import {
  ensureCardCreationAllowed,
  getCurrentUserHandler,
  deleteAccountHandler,
  authComponent
} from "../auth";
import {
  CARD_ERROR_CODES,
  FREE_TIER_LIMIT,
} from "../shared/constants";
import { polar } from "../billing";

describe("auth", () => {
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
                    withIndex: () => ({
                        collect: async () => Array.from({ length: FREE_TIER_LIMIT - 1 }),
                    }),
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

    describe("getCurrentUser", () => {
        const mockGetAuthUser = mock();
        authComponent.getAuthUser = mockGetAuthUser;

        const mockGetCurrentSubscription = mock();
        polar.getCurrentSubscription = mockGetCurrentSubscription;

        beforeEach(() => {
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
                        withIndex: () => ({
                            collect: async () => [],
                        })
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
                         withIndex: () => ({
                             collect: async () => [],
                         })
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
                        withIndex: () => ({
                            collect: async () => Array.from({length: 100}), // Lots of cards
                        })
                    })
                }
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
                         withIndex: () => ({
                             collect: async () => [
                                 { _id: "c1", fileId: "f1", thumbnailId: "t1" },
                                 { _id: "c2" }
                             ]
                         })
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
});

