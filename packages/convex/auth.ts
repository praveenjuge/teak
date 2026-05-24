import { expo } from "@better-auth/expo";
import {
  type AuthFunctions,
  createClient,
  type GenericCtx,
} from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { requireActionCtx } from "@convex-dev/better-auth/utils";
import { Resend } from "@convex-dev/resend";
import { type BetterAuthOptions, betterAuth } from "better-auth/minimal";
import { ConvexError } from "convex/values";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import {
  internalAction,
  type MutationCtx,
  mutation,
  query,
} from "./_generated/server";
import authConfig from "./auth.config";
import { polar } from "./billing";
import { isLocalDevelopmentUrl, resolveTeakDevAppUrl } from "./devUrls";
import {
  CARD_ERROR_CODES,
  CARD_ERROR_MESSAGES,
  FREE_TIER_LIMIT,
} from "./shared/constants";
import { rateLimiter } from "./shared/rateLimits";
import { scheduleBusinessEvent } from "./sentry";
import { deleteObject } from "./storage/r2";

const googleClientId = process.env.GOOGLE_CLIENT_ID!;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET!;
const siteUrl = process.env.SITE_URL;
if (!siteUrl) {
  throw new Error(
    "SITE_URL environment variable is required. " +
      "Run: bunx convex env set SITE_URL http://app.teak.localhost:1355"
  );
}
let usesSecureCookies: boolean;
try {
  usesSecureCookies = new URL(siteUrl).protocol === "https:";
} catch {
  throw new Error(
    `SITE_URL environment variable is not a valid URL (received: "${siteUrl}"). ` +
      "Example: http://app.teak.localhost:1355"
  );
}
const desktopDevOrigins = ["http://localhost:1420", "http://127.0.0.1:1420"];
const appDevUrl = resolveTeakDevAppUrl(process.env);

export const trustedOrigins = [
  siteUrl,
  "https://*.teakvault.com",
  "https://app.teakvault.com",
  "tauri://localhost",
  "teak://",
  "teak://*",
  "chrome-extension://negnmfifahnnagnbnfppmlgfajngdpob",
  appDevUrl,
  "https://appleid.apple.com",
  ...(isLocalDevelopmentUrl(siteUrl)
    ? [
        ...desktopDevOrigins,
        "exp+teak://*",
        "exp://*/*",
        "exp://10.0.0.*:*/*",
        "exp://192.168.*.*:*/*",
        "exp://172.*.*.*:*/*",
        "exp://localhost:*/*",
      ]
    : []),
];

// The component client has methods needed for integrating Convex with Better Auth,
// as well as helper methods for general use.
const authFunctions = (internal as any).auth as AuthFunctions;

export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      onCreate: async (ctx, user) => {
        await ctx.scheduler.runAfter(
          0,
          internal.card.defaultCards.createDefaultCardsForUser,
          { userId: user._id }
        );
        await scheduleUserCreatedBusinessEvent(ctx, user._id);
      },
    },
  },
});

export const scheduleUserCreatedBusinessEvent = (
  ctx: Parameters<typeof scheduleBusinessEvent>[0],
  userId: string
) =>
  scheduleBusinessEvent(ctx, {
    event: "user.created",
    userId,
    surface: "auth",
  });

export const { getAuthUser } = authComponent.clientApi();
export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

export const resend = new Resend(components.resend, {
  testMode: false,
});

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    trustedOrigins,
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    rateLimit: {
      enabled: true,
      window: 60,
      max: 120,
      storage: "database",
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 300, max: 5 },
        "/reset-password": { window: 300, max: 5 },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      freshAge: 60 * 10,
      updateAge: 60 * 60 * 24,
    },
    account: {
      encryptOAuthTokens: true,
      updateAccountOnSignIn: true,
      accountLinking: {
        enabled: true,
        trustedProviders: ["google", "apple", "email-password"],
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
      },
    },
    advanced: {
      useSecureCookies: usesSecureCookies,
      disableCSRFCheck: false,
      disableOriginCheck: false,
    },
    telemetry: {
      enabled: false,
    },
    onAPIError: {
      errorURL: "/login",
      onError: (error) => {
        console.error("Better Auth error:", error);
      },
    },
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
      // Disable email verification requirement in development for E2E testing
      requireEmailVerification: process.env.NODE_ENV !== "development",
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
      sendOnSignUp: process.env.NODE_ENV === "production",
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await resend.sendEmail(requireActionCtx(ctx), {
          from: "Teak <hello@teakvault.com>",
          to: user.email,
          subject: "Verify your email address",
          html: `<p>Click <a target="_blank" href="${url}">here</a> to verify your email address.</p>`,
        });
      },
    },
    user: {
      deleteUser: {
        enabled: true,
      },
    },
    plugins: [
      expo(),
      convex({
        authConfig,
        jwksRotateOnTokenGenerationError: true,
        jwks: process.env.JWKS,
      }),
    ],
  } satisfies BetterAuthOptions);
};

// Get the current user
export const getCurrentUserHandler = async (ctx: any) => {
  // After sign-out the client may still briefly call this query; treat missing
  // session as a non-error so we don't spam Convex logs with "Unauthenticated".
  let user: Awaited<ReturnType<typeof authComponent.getAuthUser>> | undefined;
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

  const cardsQuery = ctx.db
    .query("cards")
    .withIndex("by_user_deleted", (q: any) =>
      q.eq("userId", userId).eq("isDeleted", undefined)
    );
  const cardCount = hasPremium
    ? (await cardsQuery.collect()).length
    : (await cardsQuery.take(FREE_TIER_LIMIT)).length;
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

export const getCardCreationStatusHandler = async (ctx: any) => {
  // After sign-out the client may still briefly call this query; treat missing
  // session as a non-error so we don't spam Convex logs with "Unauthenticated".
  let user: Awaited<ReturnType<typeof authComponent.getAuthUser>> | undefined;
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

  if (hasPremium) {
    return {
      hasPremium,
      canCreateCard: true,
    };
  }

  const activeCardCount = (
    await ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q: any) =>
        q.eq("userId", userId).eq("isDeleted", undefined)
      )
      .take(FREE_TIER_LIMIT)
  ).length;

  return {
    hasPremium,
    canCreateCard: activeCardCount < FREE_TIER_LIMIT,
  };
};

export const getCardCreationStatus = query({
  args: {},
  handler: getCardCreationStatusHandler,
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
    args: { userId: string }
  ) => Promise<{ status?: string } | null | undefined>;
};

const defaultCardCreationDeps: CardCreationDeps = {
  rateLimiter,
  getSubscription: (ctx, args) => polar.getCurrentSubscription(ctx, args),
};

export async function ensureCardCreationAllowed(
  ctx: MutationCtx,
  userId: string,
  deps: CardCreationDeps = defaultCardCreationDeps
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

  const cardCount = (
    await ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) =>
        q.eq("userId", userId).eq("isDeleted", undefined)
      )
      .take(FREE_TIER_LIMIT)
  ).length;

  if (cardCount >= FREE_TIER_LIMIT) {
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
  let deletedStorageObjectCount = 0;

  // Use by_user_deleted index with partial match (just userId)
  // This works because Convex allows querying on prefix of compound indexes
  const cards = await ctx.db
    .query("cards")
    .withIndex("by_user_deleted", (q: any) => q.eq("userId", userId))
    .collect();

  for (const card of cards) {
    if (card.fileKey) {
      await deleteObject(ctx, card.fileKey);
      deletedStorageObjectCount += 1;
    }
    if (card.thumbnailKey) {
      await deleteObject(ctx, card.thumbnailKey);
      deletedStorageObjectCount += 1;
    }

    await ctx.db.delete("cards", card._id);
  }

  return { deletedCards: cards.length, deletedStorageObjectCount };
};

export const deleteAccount = mutation({
  args: {},
  handler: deleteAccountHandler,
});

export const getLatestJwks = internalAction({
  args: {},
  handler: async (ctx) => {
    const auth = createAuth(ctx);
    // This method is added by the Convex Better Auth plugin and is
    // available via `auth.api` only, not exposed as a route.
    return await auth.api.getLatestJwks();
  },
});
