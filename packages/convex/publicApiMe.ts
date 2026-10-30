import { v } from "convex/values";
import { internal } from "./_generated/api";
import { type ActionCtx, httpAction, internalQuery } from "./_generated/server";
import { readHasPremium } from "./auth";
import { getActiveCardCount } from "./card/cardUsage";
import { withAuthorizedUser } from "./publicApi/http/auth";
import { withPublicApiGatewayHeaders } from "./publicApi/http/meta";
import { getAppBaseUrl } from "./publicApi/http/serializers";
import { errorResponse, json } from "./publicApi/http/shared";
import { readWorkosProfile } from "./securitySessions";
import { readAccountLocale } from "./settings/preferences";
import { FREE_TIER_LIMIT } from "./shared/constants";
import type { WorkosResource } from "./workos/tokens";

export const profileForOwner = internalQuery({
  args: { teakUserId: v.string(), includeUsage: v.optional(v.boolean()) },
  returns: v.union(
    v.object({
      id: v.string(),
      email: v.string(),
      name: v.optional(v.string()),
      cardCount: v.optional(v.number()),
      cardLimit: v.optional(v.union(v.number(), v.null())),
      plan: v.optional(v.union(v.literal("free"), v.literal("pro"))),
      locale: v.string(),
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
    // Until the webhook stores the profile, the owner row holds the verified
    // address sign-in created it with.
    const provider = await readWorkosProfile(ctx, mirror.workosUserId);
    if (!(provider || mirror.emailVerified)) {
      return null;
    }
    const name = provider
      ? (provider.name ??
        [provider.firstName, provider.lastName].filter(Boolean).join(" "))
      : null;
    return {
      id: teakUserId,
      email: provider?.email ?? mirror.email,
      ...(name ? { name } : {}),
      ...usage,
      locale: await readAccountLocale(ctx, teakUserId),
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
