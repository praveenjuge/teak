import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { expo } from '@better-auth/expo'
import { api, components } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { betterAuth, BetterAuthOptions } from "better-auth";
import { Resend } from "@convex-dev/resend";
import { requireActionCtx } from "@convex-dev/better-auth/utils";
import { polar } from "./billing";
import { FREE_TIER_LIMIT, CARD_ERROR_CODES, CARD_ERROR_MESSAGES } from "./shared/constants";
import { ConvexError } from "convex/values";
import { rateLimiter } from "./shared/rateLimits";
import authConfig from "./auth.config";

const googleClientId = process.env.GOOGLE_CLIENT_ID!;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET!;
const siteUrl = process.env.SITE_URL!;

// The component client has methods needed for integrating Convex with Better Auth,
// as well as helper methods for general use.
export const authComponent = createClient<DataModel>(components.betterAuth);

export const resend = new Resend(components.resend, {
  testMode: false,
});

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    trustedOrigins: [
      siteUrl,
      "app.teakvault.com",
      "https://*.teakvault.com",
      "https://app.teakvault.com",
      "teak://",
      "teak://*",
      "chrome-extension://negnmfifahnnagnbnfppmlgfajngdpob",
      "http://localhost:3000",
      "https://appleid.apple.com",
      ...(process.env.NODE_ENV === "development" ? [
        "exp+teak://*",
        "exp://*/*",                 // Trust all Expo development URLs
        "exp://10.0.0.*:*/*",        // Trust 10.0.0.x IP range
        "exp://192.168.*.*:*/*",     // Trust 192.168.x.x IP range
        "exp://172.*.*.*:*/*",       // Trust 172.x.x.x IP range
        "exp://localhost:*/*"        // Trust localhost
      ] : []),
    ],
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    socialProviders: {
      google: {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        prompt: "select_account",
      },
      apple: {
        clientId: process.env.APPLE_CLIENT_ID as string,
        clientSecret: process.env.APPLE_CLIENT_SECRET as string,
        // Optional
        appBundleIdentifier: process.env.APPLE_APP_BUNDLE_IDENTIFIER as string,
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await resend.sendEmail(requireActionCtx(ctx), {
          from: "Teak <hello@teakvault.com>",
          to: user.email,
          subject: "Reset your Password",
          html: `<p>Click <a target="_blank" href="${url}">here</a> to reset your password.</p>`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await resend.sendEmail(requireActionCtx(ctx), {
          from: "Teak <hello@teakvault.com>",
          to: user.email,
          subject: 'Verify your email address',
          html: `<p>Click <a target="_blank" href="${url}">here</a> to verify your email address.</p>`,
        })
      }
    },
    user: {
      deleteUser: {
        enabled: true
      }
    },
    plugins: [
      expo(),
      convex({
        authConfig,
        jwksRotateOnTokenGenerationError: true,
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // Schedule default card creation asynchronously
            // Using scheduler to avoid blocking user creation
            // @ts-ignore - scheduler exists on MutationCtx
            ctx.scheduler.runAfter(0, api.card.defaultCards.createDefaultCardsForUser, {
              userId: user.id,
            }).catch((err: Error) => {
              // Log but don't throw - user creation should succeed even if card creation fails
              console.error("Failed to schedule default cards:", err);
            });
          },
        },
      },
    },
  } satisfies BetterAuthOptions);
};

// Get the current user
export const getCurrentUserHandler = async (ctx: any) => {
  // After sign-out the client may still briefly call this query; treat missing
  // session as a non-error so we don't spam Convex logs with "Unauthenticated".
  let user;
  try {
    user = await authComponent.getAuthUser(ctx);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthenticated") {
      return null;
    }
    throw error;
  }
  if (!user) return null;

  const userId = (user as any).id ?? (user as any)._id ?? (user as any).subject;

  let hasPremium = false;
  try {
    const subscription = await polar.getCurrentSubscription(ctx, {
      userId,
    });
    hasPremium = subscription?.status === "active";
  } catch {
    hasPremium = false;
  }

  const cards = await ctx.db
    .query("cards")
    .withIndex("by_user_deleted", (q: any) =>
      q.eq("userId", userId).eq("isDeleted", undefined),
    )
    .collect();
  const cardCount = cards.length;
  const canCreateCard = hasPremium || cardCount < FREE_TIER_LIMIT;

  return {
    ...user,
    hasPremium,
    cardCount,
    canCreateCard,
  };
};

export const getCurrentUser = query({
  args: {},
  handler: getCurrentUserHandler,
});

/**
 * Ensures the current user can create a new card.
 * Checks both rate limits (30 cards/minute) and card count limits (free tier).
 * Throws a ConvexError with appropriate code when limits are exceeded.
 */
type CardCreationDeps = {
  rateLimiter: Pick<typeof rateLimiter, "limit">;
  getSubscription: (
    ctx: MutationCtx,
    args: { userId: string },
  ) => Promise<{ status?: string } | null | undefined>;
};

const defaultCardCreationDeps: CardCreationDeps = {
  rateLimiter,
  getSubscription: (ctx, args) => polar.getCurrentSubscription(ctx, args),
};

export async function ensureCardCreationAllowed(
  ctx: MutationCtx,
  userId: string,
  deps: CardCreationDeps = defaultCardCreationDeps,
): Promise<void> {
  // Check rate limit first (fast fail for abuse prevention)
  const rateLimitResult = await deps.rateLimiter.limit(ctx, "cardCreation", {
    key: userId,
    throws: false,
  });

  if (!rateLimitResult.ok) {
    throw new ConvexError({
      code: CARD_ERROR_CODES.RATE_LIMITED,
      message: CARD_ERROR_MESSAGES.RATE_LIMITED,
    });
  }

  let hasPremium = false;
  try {
    const subscription = await deps.getSubscription(ctx, { userId });
    hasPremium = subscription?.status === "active";
  } catch {
    hasPremium = false;
  }

  if (hasPremium) {
    return;
  }

  const cards = await ctx.db
    .query("cards")
    .withIndex("by_user_deleted", (q) =>
      q.eq("userId", userId).eq("isDeleted", undefined),
    )
    .collect();

  if (cards.length >= FREE_TIER_LIMIT) {
    throw new ConvexError({
      code: CARD_ERROR_CODES.CARD_LIMIT_REACHED,
      message: CARD_ERROR_MESSAGES.CARD_LIMIT_REACHED,
    });
  }
}

export const deleteAccountHandler = async (ctx: any) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("User must be authenticated");
  }

  const userId = identity.subject;

  // Use by_user_deleted index with partial match (just userId)
  // This works because Convex allows querying on prefix of compound indexes
  const cards = await ctx.db
    .query("cards")
    .withIndex("by_user_deleted", (q: any) => q.eq("userId", userId))
    .collect();

  for (const card of cards) {
    if (card.fileId) {
      await ctx.storage.delete(card.fileId);
    }
    if (card.thumbnailId) {
      await ctx.storage.delete(card.thumbnailId);
    }

    await ctx.db.delete("cards", card._id);
  }

  return { deletedCards: cards.length };
};

export const deleteAccount = mutation({
  args: {},
  handler: deleteAccountHandler,
});
