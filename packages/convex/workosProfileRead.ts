import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";

// Provider state and unresolved conflicts are authoritative. A cached component
// profile cannot restore access after a deletion or conflicting provider update.
export async function readCanonicalWorkosProfile(
  ctx: Pick<QueryCtx, "db">,
  workosUserId: string
) {
  const profiles = await ctx.db
    .query("workosProfiles")
    .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
    .take(2);
  if (profiles.length !== 1) {
    return null;
  }
  const record = profiles[0];
  if (
    record.deletedAt !== undefined ||
    !record.profile ||
    !record.providerUpdatedAt
  ) {
    return null;
  }
  for (const reason of [
    "profile_pending",
    "equal_timestamp_conflict",
    "duplicate_mapping",
    "external_id_mismatch",
    "link_conflict",
  ] as const) {
    const conflict = await ctx.db
      .query("migrationQuarantine")
      .withIndex("by_workosUserId_and_reason_and_resolvedAt", (q) =>
        q
          .eq("workosUserId", workosUserId)
          .eq("reason", reason)
          .eq("resolvedAt", undefined)
      )
      .first();
    if (conflict) {
      return null;
    }
  }
  const deleted = await ctx.db
    .query("workosEvents")
    .withIndex("by_workosUserId_and_type", (q) =>
      q.eq("workosUserId", workosUserId).eq("type", "user.deleted")
    )
    .first();
  return deleted ? null : record;
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
    const record = await readCanonicalWorkosProfile(ctx, workosUserId);
    if (!record?.profile) {
      return null;
    }
    const profile = record.profile;
    return {
      id: workosUserId,
      ...profile,
      name:
        profile.name ??
        ([profile.firstName, profile.lastName].filter(Boolean).join(" ") ||
          null),
    };
  },
});
