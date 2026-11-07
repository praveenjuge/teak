import { v } from "convex/values";
import { type QueryCtx, query } from "./_generated/server";
import { readSignupsPaused } from "./adminAccess";
import { readCardEntitlement } from "./billing/polar";
import { getActiveCardCount } from "./card/cardUsage";
import { readWorkosClientId } from "./env";

export { ensureCardCreationAllowed } from "./card/quota";

import { getSessionProfile } from "./securitySessions";
import { FREE_TIER_LIMIT } from "./shared/constants";

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
    ...(readWorkosClientId() ? { authKitClientId: readWorkosClientId() } : {}),
  }),
});

export const getCurrentUserHandler = async (ctx: QueryCtx) => {
  const profile = await getSessionProfile(ctx);
  if (!profile) {
    return null;
  }
  const { user, teakUserId: userId } = profile;

  const hasPremium = await readCardEntitlement(ctx, userId);

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

export const getCardCreationStatusHandler = async (ctx: QueryCtx) => {
  const profile = await getSessionProfile(ctx);
  if (!profile) {
    return null;
  }
  const { teakUserId: userId } = profile;

  const hasPremium = await readCardEntitlement(ctx, userId);

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
