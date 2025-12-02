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

const googleClientId = process.env.GOOGLE_CLIENT_ID!;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET!;

const siteUrl = process.env.SITE_URL!;

// The component client has methods needed for integrating Convex with Better Auth,
// as well as helper methods for general use.
export const authComponent = createClient<DataModel>(components.betterAuth);

export const resend = new Resend(components.resend, {
  testMode: false,
});

export const createAuth = (
  ctx: GenericCtx<DataModel>,
  { optionsOnly } = { optionsOnly: false },
) => {
  return betterAuth({
    logger: {
      disabled: optionsOnly,
      level: "debug",
    },
    trustedOrigins: [
      siteUrl,
      "app.teakvault.com",
      "https://app.teakvault.com",
      "teak://",
      "teak://*",
      "chrome-extension://negnmfifahnnagnbnfppmlgfajngdpob",
      "http://localhost:3000",
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
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await resend.sendEmail(requireActionCtx(ctx), {
          from: "Teak <hello@teakvault.com>",
          to: user.email,
          subject: "Reset your Password",
          html: `<p>Click <a href="${url}">here</a> to reset your password.</p>`,
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
          text: `Click the link to verify your email: ${url}`
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
      convex(),
    ],
  } satisfies BetterAuthOptions);
};

// Get the current user
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
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
      .withIndex("by_user_deleted", (q) =>
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
  },
});

/**
 * Ensures the current user can create a new card.
 * Checks both rate limits (30 cards/minute) and card count limits (free tier).
 * Throws a ConvexError with appropriate code when limits are exceeded.
 */
export async function ensureCardCreationAllowed(
  ctx: MutationCtx,
  userId: string,
): Promise<void> {
  // Check rate limit first (fast fail for abuse prevention)
  const rateLimitResult = await rateLimiter.limit(ctx, "cardCreation", {
    key: userId,
    throws: false,
  });

  if (!rateLimitResult.ok) {
    throw new ConvexError({
      code: CARD_ERROR_CODES.RATE_LIMITED,
      message: CARD_ERROR_MESSAGES.RATE_LIMITED,
    });
  }

  // Check card count limit using getCurrentUser (which calculates canCreateCard)
  const currentUser = await ctx.runQuery(api.auth.getCurrentUser);

  if (!currentUser) {
    throw new Error("User must be authenticated");
  }

  if (!currentUser.canCreateCard) {
    throw new ConvexError({
      code: CARD_ERROR_CODES.CARD_LIMIT_REACHED,
      message: CARD_ERROR_MESSAGES.CARD_LIMIT_REACHED,
    });
  }
}

export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("User must be authenticated");
    }

    const userId = identity.subject;

    // Use by_user_deleted index with partial match (just userId)
    // This works because Convex allows querying on prefix of compound indexes
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) => q.eq("userId", userId))
      .collect();

    for (const card of cards) {
      if (card.fileId) {
        await ctx.storage.delete(card.fileId);
      }
      if (card.thumbnailId) {
        await ctx.storage.delete(card.thumbnailId);
      }

      await ctx.db.delete(card._id);
    }

    return { deletedCards: cards.length };
  },
});
