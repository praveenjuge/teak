import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { readComponentUser } from "./securitySessions";

// The WorkOS AuthKit component holds the provider profile. Teak's own deletion
// tombstone still wins: a deleted WorkOS user never regains a profile, even if
// a stale component row or a late event says otherwise.
export async function readCanonicalWorkosProfile(
  ctx: Pick<QueryCtx, "db" | "runQuery">,
  workosUserId: string
) {
  const deleted = await ctx.db
    .query("workosEvents")
    .withIndex("by_workosUserId_and_type", (q) =>
      q.eq("workosUserId", workosUserId).eq("type", "user.deleted")
    )
    .first();
  if (deleted) {
    return null;
  }
  return await readComponentUser(ctx, workosUserId);
}

export const getProfile = internalQuery({
  args: { workosUserId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      id: v.string(),
      email: v.string(),
      emailVerified: v.boolean(),
      externalId: v.union(v.string(), v.null()),
      firstName: v.union(v.string(), v.null()),
      lastName: v.union(v.string(), v.null()),
      profilePictureUrl: v.union(v.string(), v.null()),
      name: v.union(v.string(), v.null()),
    })
  ),
  handler: async (ctx, { workosUserId }) => {
    const user = await readCanonicalWorkosProfile(ctx, workosUserId);
    if (!user) {
      return null;
    }
    const firstName = user.firstName ?? null;
    const lastName = user.lastName ?? null;
    return {
      id: workosUserId,
      email: user.email,
      emailVerified: user.emailVerified,
      externalId: user.externalId ?? null,
      firstName,
      lastName,
      profilePictureUrl: user.profilePictureUrl ?? null,
      name:
        user.name ?? ([firstName, lastName].filter(Boolean).join(" ") || null),
    };
  },
});
