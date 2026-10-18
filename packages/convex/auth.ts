import { v } from "convex/values";
import { type QueryCtx, query } from "./_generated/server";
import { readSignupsPaused } from "./adminAccess";
import { polar } from "./billing";
import { getActiveCardCount } from "./card/cardUsage";

export { ensureCardCreationAllowed } from "./card/quota";

import { getSessionProfile } from "./securitySessions";
import { FREE_TIER_LIMIT } from "./shared/constants";
import { isApprovedActiveSubscription } from "./shared/polarPlans";

export const getAuthUserHandler = async (ctx: QueryCtx) =>
  (await getSessionProfile(ctx))?.user ?? null;

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

// Published mobile clients still read this to start hosted AuthKit. Released
// Apple and Android builds decode `accountChangesPaused` as a required field,
// so it stays in the response, always false, until those builds are retired.
export const getAuthMode = query({
  args: {},
  returns: v.object({
    primary: v.literal("workos"),
    signupsDisabled: v.boolean(),
    accountChangesPaused: v.boolean(),
    authKitClientId: v.optional(v.string()),
  }),
  handler: async (ctx): Promise<PublicAuthMode> => ({
    primary: "workos",
    signupsDisabled: await readSignupsPaused(ctx),
    accountChangesPaused: false,
    ...(process.env.WORKOS_CLIENT_ID
      ? { authKitClientId: process.env.WORKOS_CLIENT_ID }
      : {}),
  }),
});

export const readHasPremium = async (ctx: QueryCtx, userId: string) => {
  try {
    const subscription = await polar.getCurrentSubscription(ctx, { userId });
    return isApprovedActiveSubscription(subscription);
  } catch {
    return false;
  }
};

export const getCurrentUserHandler = async (ctx: any) => {
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
