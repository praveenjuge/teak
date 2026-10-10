import { v } from "convex/values";
import { type QueryCtx, query } from "./_generated/server";
import { polar } from "./billing";
import { getActiveCardCount } from "./card/cardUsage";
import { readAccountChangesPaused, readSignupsDisabled } from "./env";

export { ensureCardCreationAllowed } from "./card/quota";

import { getSessionProfile } from "./securitySessions";
import { FREE_TIER_LIMIT } from "./shared/constants";
import { isApprovedActiveSubscription } from "./shared/polarPlans";

// The web auth boundary subscribes to this at the provider level. During
// sign-out the browser still holds a briefly valid token, so the subscription
// re-runs against a cleared session. Returning null instead of throwing keeps
// that from crashing React; redirects stay with the boundary's auth state.
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

// A Polar read failure counts as no subscription rather than failing the query.
export const readHasPremium = async (ctx: QueryCtx, userId: string) => {
  try {
    const subscription = await polar.getCurrentSubscription(ctx, { userId });
    return isApprovedActiveSubscription(subscription);
  } catch {
    return false;
  }
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

  const hasPremium = await readHasPremium(ctx, userId);

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

  const hasPremium = await readHasPremium(ctx, userId);

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
