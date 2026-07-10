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
import { mcp } from "better-auth/plugins";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
  query,
} from "./_generated/server";
import authConfig from "./auth.config";
import { polar } from "./billing";
import { isLocalDevelopmentUrl, resolveTeakDevAppUrl } from "./devUrls";
import { e2eCleanupPlugin } from "./e2eCleanup";
import {
  CARD_ERROR_CODES,
  CARD_ERROR_MESSAGES,
  FREE_TIER_LIMIT,
} from "./shared/constants";
import { rateLimiter } from "./shared/rateLimits";
import { deleteObject } from "./storage/r2";
import { scheduleUserCreated } from "./telemetry/schedule";

const googleClientId = process.env.GOOGLE_CLIENT_ID;
if (!googleClientId) {
  throw new Error(
    "GOOGLE_CLIENT_ID environment variable is required. " +
      "Run: bunx convex env set GOOGLE_CLIENT_ID <client-id>"
  );
}
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!googleClientSecret) {
  throw new Error(
    "GOOGLE_CLIENT_SECRET environment variable is required. " +
      "Run: bunx convex env set GOOGLE_CLIENT_SECRET <client-secret>"
  );
}
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
        await scheduleUserCreatedTelemetry(ctx, user._id);
      },
    },
  },
});

export const scheduleUserCreatedTelemetry = (
  ctx: Pick<MutationCtx, "scheduler">,
  userId: string
) =>
  scheduleUserCreated(ctx, {
    source: "auth",
    userId,
  });

// `AuthBoundary` (see apps/web ClientAuthBoundary) subscribes to
// `api.auth.getAuthUser` at the provider level to reactively track the
// session-validated user. The stock query from `authComponent.clientApi()`
// THROWS `ConvexError("Unauthenticated")` whenever there is no valid session.
//
// During sign-out the browser still holds a momentarily-valid JWT, so the
// subscription stays mounted and re-runs against the just-cleared session. A
// thrown query result there propagates through Convex's reactive store
// notification and crashes React (Minified React error #310) on whatever page
// the user is on, instead of redirecting cleanly. It also spams the backend
// logs with server errors on every sign-out.
//
// Mirror the resilient pattern used by `getCurrentUser` /
// `getCardCreationStatus` and return null instead of throwing. Redirect on
// unauth is still driven by `AuthBoundary`'s `useConvexAuth()` effect and the
// app's explicit post-sign-out navigation.
export const getAuthUserHandler = async (ctx: any) => {
  try {
    return (await authComponent.safeGetAuthUser(ctx)) ?? null;
  } catch {
    return null;
  }
};

export const getAuthUser = query({
  args: {},
  handler: getAuthUserHandler,
});

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
        // Dynamic client registration is unauthenticated; throttle spam into
        // the oauthApplication table. Token exchange is hit on every refresh.
        "/mcp/token": { window: 60, max: 30 },
        "/mcp/register": { window: 60, max: 5 },
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
      requireEmailVerification: !isLocalDevelopmentUrl(siteUrl),
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
      sendOnSignUp: !isLocalDevelopmentUrl(siteUrl),
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
        beforeDelete: async (user) => {
          await requireActionCtx(ctx).runMutation(
            internal.auth.deleteAccountData,
            {
              userId: user.id,
            }
          );
        },
      },
    },
    plugins: [
      expo(),
      e2eCleanupPlugin(ctx),
      convex({
        authConfig,
        jwksRotateOnTokenGenerationError: true,
        jwks: process.env.JWKS,
      }),
      // OAuth 2.1 authorization server for browser-login clients (Raycast,
      // desktop, MCP). Access/refresh tokens are opaque strings stored in the
      // component's oauthAccessToken table; PKCE S256 is enforced.
      //
      // NOTE: in better-auth 1.6.11 the mcp plugin resolves clients from the
      // `oauthApplication` table, not from `trustedClients` below. The clients
      // are actually registered by `oauthClients.ensureOAuthClients` (seeded via
      // cron). `trustedClients` is retained to document the clients and for
      // forward-compatibility.
      mcp({
        loginPage: "/login",
        oidcConfig: {
          loginPage: "/login",
          accessTokenExpiresIn: 3600, // 1h
          // 30d refresh so Raycast / desktop are not re-prompted weekly.
          refreshTokenExpiresIn: 60 * 60 * 24 * 30,
          codeExpiresIn: 600, // 10m
          allowPlainCodeChallengeMethod: false, // force S256
          trustedClients: [
            {
              clientId: "teak-raycast",
              clientSecret: "",
              type: "public",
              name: "Raycast",
              disabled: false,
              skipConsent: true,
              metadata: null,
              // Exact-string matched. Captured from the live Raycast Web
              // redirect method (`packageName=Extension`). Kept in sync with
              // oauthClients.ts (which actually seeds these into the DB).
              redirectUrls: [
                "https://raycast.com/redirect?packageName=Extension",
                "https://raycast.com/redirect/extension",
                "https://raycast.com/redirect",
                "raycast://oauth?package_name=teak",
              ],
            },
            {
              clientId: "teak-desktop",
              clientSecret: "",
              type: "public",
              name: "Teak Desktop",
              disabled: false,
              skipConsent: true,
              metadata: null,
              // Exact-match loopback URIs; the desktop app tries 14203 first
              // then falls back to 24203.
              redirectUrls: [
                "http://127.0.0.1:14203/oauth/callback",
                "http://127.0.0.1:24203/oauth/callback",
              ],
            },
            {
              clientId: "teak-cli",
              clientSecret: "",
              type: "public",
              name: "Teak CLI",
              disabled: false,
              skipConsent: true,
              metadata: null,
              redirectUrls: [
                "http://127.0.0.1:14210/oauth/callback",
                "http://127.0.0.1:24210/oauth/callback",
              ],
            },
          ],
        },
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
  if (!user) {
    return null;
  }

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
  if (!user) {
    return null;
  }

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
interface CardCreationDeps {
  getSubscription: (
    ctx: MutationCtx,
    args: { userId: string }
  ) => Promise<{ status?: string } | null | undefined>;
  rateLimiter: Pick<typeof rateLimiter, "limit">;
}

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
      retryAt: Date.now() + rateLimitResult.retryAfter,
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

export const deleteAccountDataHandler = async (
  ctx: MutationCtx,
  userId: string
) => {
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

  // Import source archives and reports are private R2 objects outside card
  // storage. Schedule their deletion before removing the ownership records.
  if (ctx.scheduler) {
    const jobs = await ctx.db
      .query("importJobs")
      .withIndex("by_user_created", (q: any) => q.eq("userId", userId))
      .collect();
    if (jobs.length) {
      await ctx.scheduler.runAfter(
        0,
        (internal as any)["import/runImport"].deleteAccountImportObjects,
        {
          objects: jobs.map((job: any) => ({
            sourceKey: job.sourceKey,
            reportKey: job.reportKey,
            uploadId: job.uploadId,
          })),
        }
      );
    }
    const items = await ctx.db
      .query("importJobItems")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();
    for (const item of items) {
      await ctx.db.delete("importJobItems", item._id);
    }
    for (const job of jobs) {
      await ctx.db.delete("importJobs", job._id);
    }
  }

  return { deletedCards: cards.length, deletedStorageObjectCount };
};

export const deleteAccountData = internalMutation({
  args: { userId: v.string() },
  returns: v.object({
    deletedCards: v.number(),
    deletedStorageObjectCount: v.number(),
  }),
  handler: async (ctx, { userId }) => deleteAccountDataHandler(ctx, userId),
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
