import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { type ActionCtx, httpAction, internalQuery } from "./_generated/server";
import { withAuthorizedUser } from "./publicApiHttpAuth";
import { errorResponse, json } from "./publicApiHttpShared";
import { withPublicApiGatewayHeaders } from "./publicApiMeta";

// Only the bearer middleware supplies this permanent owner ID. This query is
// internal so callers cannot select another user's profile.
export const profileForOwner = internalQuery({
  args: { teakUserId: v.string() },
  returns: v.union(
    v.object({
      id: v.string(),
      email: v.string(),
      name: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, { teakUserId }) => {
    const mirror = await ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", teakUserId))
      .unique();
    if (mirror?.deletedAt !== undefined) {
      return null;
    }
    const legacy = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "_id", operator: "eq", value: teakUserId }],
    });
    const email = mirror?.email ?? legacy?.email;
    if (typeof email !== "string") {
      return null;
    }
    return {
      id: teakUserId,
      email,
      ...(typeof legacy?.name === "string" ? { name: legacy.name } : {}),
    };
  },
});

export async function handleMeRequest(ctx: ActionCtx, request: Request) {
  const auth = await withAuthorizedUser(ctx, request);
  if ("error" in auth) {
    return auth.error;
  }
  try {
    const profile = await ctx.runQuery(internal.publicApiMe.profileForOwner, {
      teakUserId: auth.validated.userId,
    });
    return profile
      ? json(200, { data: profile })
      : errorResponse(401, "UNAUTHORIZED", "User profile unavailable");
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Failed to load user profile");
  }
}

export const meV1 = httpAction(async (ctx, request) =>
  withPublicApiGatewayHeaders(await handleMeRequest(ctx, request))
);
