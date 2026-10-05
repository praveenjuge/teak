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
import { v } from "convex/values";
import { importPKCS8, SignJWT } from "jose";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import {
  env,
  internalAction,
  type MutationCtx,
  query,
} from "./_generated/server";
import authConfig from "./auth.config";
import { polar } from "./billing";
import { getActiveCardCount } from "./card/cardUsage";
import {
  getAppleCredentials,
  getGoogleCredentials,
  readAccountChangesPaused,
  readAuthPrimary,
  readJwksDocument,
  readSignupsDisabled,
  readSiteUrl,
} from "./env";

export { ensureCardCreationAllowed } from "./card/quota";

import { isLocalDevelopmentUrl } from "./devUrls";
import { e2eCleanupPlugin } from "./e2eCleanup";
import { assertLegacyCredentialWrite } from "./migration/workosLegacyCredentialGate";
import { teakOAuthSecurity } from "./oauthSecurity";
import { getSessionProfile } from "./securitySessions";
import { FREE_TIER_LIMIT } from "./shared/constants";
import { isApprovedActiveSubscription } from "./shared/polarPlans";
import {
  normalizeErrorClass,
  resolveBackendTelemetryDsn,
} from "./shared/telemetry";
import { guardUserCreation } from "./signupFreeze";
import { scheduleAuthOutcome, scheduleUserCreated } from "./telemetry/schedule";
import { buildTrustedOrigins } from "./trustedOrigins";
import { mirrorBetterAuthUser } from "./userIdentityTable";

const siteUrl = readSiteUrl();
const usesSecureCookies = new URL(siteUrl).protocol === "https:";
const APPLE_CLIENT_SECRET_TTL_SECONDS = 180 * 24 * 60 * 60;

interface AppleClientSecretConfig {
  clientId: string;
  keyId: string;
  privateKey: string;
  teamId: string;
}

const createGoogleProvider = () => {
  const credentials = getGoogleCredentials();
  if (!credentials) {
    throw new Error("Google sign-in is not configured on this deployment.");
  }
  return {
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    prompt: "select_account" as const,
    disableImplicitSignUp: readSignupsDisabled(),
  };
};

export const generateAppleClientSecret = async (
  config: AppleClientSecretConfig,
  now = Date.now()
): Promise<string> => {
  const issuedAt = Math.floor(now / 1000);
  const privateKey = config.privateKey.replace(/\\n/g, "\n").trim();
  const signingKey = await importPKCS8(`${privateKey}\n`, "ES256");

  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: config.keyId })
    .setIssuer(config.teamId)
    .setSubject(config.clientId)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + APPLE_CLIENT_SECRET_TTL_SECONDS)
    .sign(signingKey);
};

const createAppleProvider = async () => {
  const credentials = getAppleCredentials();
  if (!credentials) {
    throw new Error("Apple sign-in is not configured on this deployment.");
  }
  return {
    clientId: credentials.clientId,
    clientSecret: await generateAppleClientSecret({
      clientId: credentials.clientId,
      keyId: credentials.keyId,
      privateKey: credentials.privateKey,
      teamId: credentials.teamId,
    }),
    disableImplicitSignUp: readSignupsDisabled(),
    ...(credentials.appBundleIdentifier
      ? { appBundleIdentifier: credentials.appBundleIdentifier }
      : {}),
  };
};

export const trustedOrigins = buildTrustedOrigins(siteUrl);

// The component client has methods needed for integrating Convex with Better Auth,
// as well as helper methods for general use.
const authFunctions = (internal as any).auth as AuthFunctions;

export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    session: {
      onCreate: assertLegacyCredentialWrite,
      onUpdate: assertLegacyCredentialWrite,
    },
    oauthAccessToken: {
      onCreate: assertLegacyCredentialWrite,
      onUpdate: assertLegacyCredentialWrite,
    },
    user: {
      onCreate: async (ctx, user) => {
        await mirrorBetterAuthUser(ctx, user);
        await ctx.scheduler.runAfter(
          0,
          internal.card.defaultCards.createDefaultCardsForUser,
          { userId: user._id }
        );
        await scheduleUserCreatedTelemetry(ctx, user._id);
      },
      onUpdate: async (ctx, user) => {
        await mirrorBetterAuthUser(ctx, user);
      },
      onDelete: async (ctx, user) => {
        await mirrorBetterAuthUser(ctx, user, true);
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

const hasScheduler = (
  ctx: GenericCtx<DataModel>
): ctx is GenericCtx<DataModel> & Pick<MutationCtx, "scheduler"> =>
  "scheduler" in ctx;

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
    return (await getSessionProfile(ctx))?.user ?? null;
  } catch {
    return null;
  }
};

export const getAuthUser = query({
  args: {},
  handler: getAuthUserHandler,
});

export interface PublicAuthMode {
  accountChangesPaused: boolean;
  authKitClientId?: string;
  primary: "betterauth" | "workos";
  signupsDisabled: boolean;
}

export const getAuthMode = query({
  args: {},
  returns: v.object({
    primary: v.union(v.literal("betterauth"), v.literal("workos")),
    signupsDisabled: v.boolean(),
    accountChangesPaused: v.boolean(),
    authKitClientId: v.optional(v.string()),
  }),
  // The operator flag is the sole authority. Unset preserves Better Auth.
  handler: (): PublicAuthMode => ({
    primary: readAuthPrimary(),
    signupsDisabled: readSignupsDisabled(),
    accountChangesPaused: readAccountChangesPaused(),
    ...(process.env.WORKOS_CLIENT_ID
      ? { authKitClientId: process.env.WORKOS_CLIENT_ID }
      : {}),
  }),
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
    databaseHooks: {
      user: {
        create: {
          before: (user) =>
            guardUserCreation({
              email: user.email,
              disabled: readSignupsDisabled(),
              e2eEmailDomain: env.E2E_EMAIL_DOMAIN,
            }),
        },
      },
    },
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
        // Dynamic registration remains available for MCP discovery, but is
        // tightly throttled and all external clients require explicit consent.
        "/mcp/token": { window: 60, max: 30 },
        "/mcp/register": { window: 3600, max: 10 },
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
        const errorClass = normalizeErrorClass(error);
        const logFallback = () => {
          console.error("[auth] Request failed", { errorClass });
        };
        const hasTelemetryDsn = Boolean(resolveBackendTelemetryDsn(env));
        if (!hasScheduler(ctx)) {
          logFallback();
          return;
        }
        if (!hasTelemetryDsn) {
          logFallback();
        }
        void scheduleAuthOutcome(ctx, {
          errorClass,
          outcome: "failure",
          stage: "sign_in",
        }).then((scheduled) => {
          if (hasTelemetryDsn && !scheduled) {
            logFallback();
          }
        });
      },
    },
    // Better Auth evaluates every function-valued social provider eagerly
    // when a request context is created, so only configured providers are
    // registered. Anything else would abort unrelated email and session
    // requests on deployments without social credentials.
    socialProviders: {
      ...(getGoogleCredentials() ? { google: createGoogleProvider } : {}),
      ...(getAppleCredentials() ? { apple: createAppleProvider } : {}),
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: readSignupsDisabled(),
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
          await requireActionCtx(ctx).runAction(
            internal.authActions.deleteAccountData,
            {
              userId: user.id,
            }
          );
        },
        afterDelete: async (user) => {
          await requireActionCtx(ctx).runMutation(
            internal.accountDeletion.finishAccountDataDeletion,
            { userId: user.id }
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
        jwks: readJwksDocument(),
      }),
      teakOAuthSecurity(),
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
          consentPage: "/oauth/consent",
          requirePKCE: true,
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
              skipConsent: false,
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
              skipConsent: false,
              metadata: null,
              // Exact-match loopback URIs; the desktop app tries 14203 first
              // then falls back to 24203.
              redirectUrls: [
                "http://127.0.0.1:14203/oauth/callback",
                "http://127.0.0.1:24203/oauth/callback",
              ],
            },
            {
              clientId: "teak-chrome",
              clientSecret: "",
              type: "public",
              name: "Teak Chrome",
              disabled: false,
              skipConsent: false,
              metadata: null,
              redirectUrls: [
                "https://negnmfifahnnagnbnfppmlgfajngdpob.chromiumapp.org/oauth/callback",
              ],
            },
            {
              clientId: "teak-firefox",
              clientSecret: "",
              type: "public",
              name: "Teak Firefox",
              disabled: false,
              skipConsent: false,
              metadata: null,
              redirectUrls: [
                "https://810ad09f1a9233882b69a56ac05bd31b93aad88b.extensions.allizom.org/oauth/callback",
              ],
            },
            {
              clientId: "teak-safari",
              clientSecret: "",
              type: "public",
              name: "Teak Safari",
              disabled: false,
              skipConsent: false,
              metadata: null,
              redirectUrls: ["teak-safari://oauth/callback"],
            },
            {
              clientId: "teak-cli",
              clientSecret: "",
              type: "public",
              name: "Teak CLI",
              disabled: false,
              skipConsent: false,
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
  const profile = await getSessionProfile(ctx);
  if (!profile) {
    return null;
  }
  const { user, teakUserId: userId } = profile;

  let hasPremium = false;
  try {
    const subscription = await polar.getCurrentSubscription(ctx, {
      userId,
    });
    hasPremium = isApprovedActiveSubscription(subscription);
  } catch {
    hasPremium = false;
  }

  const cardCount = await getActiveCardCount(ctx, userId);
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
  const profile = await getSessionProfile(ctx);
  if (!profile) {
    return null;
  }
  const { teakUserId: userId } = profile;

  let hasPremium = false;
  try {
    const subscription = await polar.getCurrentSubscription(ctx, {
      userId,
    });
    hasPremium = isApprovedActiveSubscription(subscription);
  } catch {
    hasPremium = false;
  }

  if (hasPremium) {
    return {
      hasPremium,
      canCreateCard: true,
    };
  }

  const cardCount = await getActiveCardCount(ctx, userId);

  return {
    hasPremium,
    canCreateCard: cardCount < FREE_TIER_LIMIT,
  };
};

export const getCardCreationStatus = query({
  args: {},
  handler: getCardCreationStatusHandler,
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
