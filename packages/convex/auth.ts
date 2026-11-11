import { v } from "convex/values";
import { type QueryCtx, query } from "./_generated/server";
import { readSignupsPaused } from "./adminAccess";
import { readCardEntitlement } from "./billing/polar";
import { readCardAllowance, readFreeCardAllowance } from "./card/quota";
import { readWorkosClientId } from "./env";
import { getSessionProfile } from "./securitySessions";

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
  const { canCreateCard, cardCount, hasPremium } = await readCardAllowance(
    ctx,
    profile.teakUserId
  );
  return { ...profile.user, hasPremium, cardCount, canCreateCard };
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

  // Premium accounts skip the card count, so their status doesn't re-run
  // with every card they save.
  if (await readCardEntitlement(ctx, userId)) {
    return { hasPremium: true, canCreateCard: true };
  }
  const { canCreateCard } = await readFreeCardAllowance(ctx, userId);
  return { hasPremium: false, canCreateCard };
};

export const getCardCreationStatus = query({
  args: {},
  handler: getCardCreationStatusHandler,
});
