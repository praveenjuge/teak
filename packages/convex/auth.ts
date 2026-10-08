import { type AuthFunctions, createClient } from "@convex-dev/better-auth";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { polar } from "./billing";
import { getActiveCardCount } from "./card/cardUsage";
import { readAccountChangesPaused, readSignupsDisabled } from "./env";

export { ensureCardCreationAllowed } from "./card/quota";

import { getSessionProfile } from "./securitySessions";
import { FREE_TIER_LIMIT } from "./shared/constants";
import { isApprovedActiveSubscription } from "./shared/polarPlans";
import { mirrorBetterAuthUser } from "./userIdentityTable";

const authFunctions = (internal as any).auth as AuthFunctions;

// Sign-in is WorkOS AuthKit. The Better Auth component stays mounted only so
// accounts from before WorkOS keep their retained rows, which account deletion
// still removes. Those rows are read-only: nothing may create or update them.
const rejectLegacyWrite = () =>
  Promise.reject(new Error("Better Auth data is read-only"));
const readOnly = { onCreate: rejectLegacyWrite, onUpdate: rejectLegacyWrite };

export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    session: readOnly,
    oauthAccessToken: readOnly,
    verification: readOnly,
    account: readOnly,
    user: {
      ...readOnly,
      onDelete: async (ctx, user) => {
        await mirrorBetterAuthUser(ctx, user, true);
      },
    },
  },
});

export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

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
  primary: "workos";
  signupsDisabled: boolean;
}

// Published mobile clients still read this to start hosted AuthKit.
export const getAuthMode = query({
  args: {},
  returns: v.object({
    primary: v.literal("workos"),
    signupsDisabled: v.boolean(),
    accountChangesPaused: v.boolean(),
    authKitClientId: v.optional(v.string()),
  }),
  handler: (): PublicAuthMode => ({
    primary: "workos",
    signupsDisabled: readSignupsDisabled(),
    accountChangesPaused: readAccountChangesPaused(),
    ...(process.env.WORKOS_CLIENT_ID
      ? { authKitClientId: process.env.WORKOS_CLIENT_ID }
      : {}),
  }),
});

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
