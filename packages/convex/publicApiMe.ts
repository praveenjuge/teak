import { v } from "convex/values";
import { internal } from "./_generated/api";
import { type ActionCtx, httpAction, internalQuery } from "./_generated/server";
import { readHasPremium } from "./auth";
import { getActiveCardCount } from "./card/cardUsage";
import { withAuthorizedUser } from "./publicApiHttpAuth";
import { errorResponse, json } from "./publicApiHttpShared";
import { getAppBaseUrl } from "./publicApiHttpValidation";
import { withPublicApiGatewayHeaders } from "./publicApiMeta";
import { readWorkosProfile } from "./securitySessions";
import { FREE_TIER_LIMIT } from "./shared/constants";
import type { WorkosResource } from "./workosTokens";

// Only the bearer middleware supplies this permanent owner ID. This query is
// internal so callers cannot select another user's profile.
export const profileForOwner = internalQuery({
  args: { teakUserId: v.string(), includeUsage: v.optional(v.boolean()) },
  returns: v.union(
    v.object({
      id: v.string(),
      email: v.string(),
      name: v.optional(v.string()),
      cardCount: v.optional(v.number()),
      // Null on Pro, which has no card limit.
      cardLimit: v.optional(v.union(v.number(), v.null())),
      plan: v.optional(v.union(v.literal("free"), v.literal("pro"))),
    }),
    v.null()
  ),
  handler: async (ctx, { teakUserId, includeUsage }) => {
    const mirror = await ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", teakUserId))
      .unique();
    if (mirror?.deletedAt !== undefined) {
      return null;
    }
    const hasPremium = includeUsage && (await readHasPremium(ctx, teakUserId));
    const usage = includeUsage
      ? {
          cardCount: await getActiveCardCount(ctx, teakUserId),
          cardLimit: hasPremium ? null : FREE_TIER_LIMIT,
          plan: hasPremium ? ("pro" as const) : ("free" as const),
        }
      : {};
    if (!mirror?.workosUserId) {
      return null;
    }
    const provider = await readWorkosProfile(ctx, mirror.workosUserId);
    if (!provider) {
      return null;
    }
    const name =
      provider.name ??
      [provider.firstName, provider.lastName].filter(Boolean).join(" ");
    return {
      id: teakUserId,
      email: provider.email,
      ...(name ? { name } : {}),
      ...usage,
    };
  },
});

export async function handleMeRequest(
  ctx: ActionCtx,
  request: Request,
  resource: WorkosResource = "api"
) {
  const auth = await withAuthorizedUser(ctx, request, { resource });
  if ("error" in auth) {
    return auth.error;
  }
  try {
    const profile = await ctx.runQuery(internal.publicApiMe.profileForOwner, {
      teakUserId: auth.validated.userId,
      includeUsage: true,
    });
    const settingsUrl = new URL("/settings", getAppBaseUrl(request.url));
    return profile
      ? json(200, { data: { ...profile, settingsUrl: settingsUrl.toString() } })
      : errorResponse(401, "UNAUTHORIZED", "User profile unavailable");
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Failed to load user profile");
  }
}

export const meV1 = httpAction(async (ctx, request) =>
  withPublicApiGatewayHeaders(await handleMeRequest(ctx, request))
);
