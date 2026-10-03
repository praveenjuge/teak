import type { MutationCtx } from "./_generated/server";

export interface BetterAuthUserSource {
  _id: string;
  email: string;
  emailVerified: boolean;
}

export const normalizeIdentityEmail = (email: string): string =>
  email.trim().toLowerCase();

// The original Better Auth id remains the permanent owner id. This mirror never
// changes links, roles, card ownership, or a deletion tombstone.
export const mirrorBetterAuthUser = async (
  ctx: Pick<MutationCtx, "db">,
  user: BetterAuthUserSource,
  deleted = false
) => {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_teakUserId", (q) => q.eq("teakUserId", user._id))
    .unique();
  if (existing?.deletedAt !== undefined) {
    return existing._id;
  }
  const profile = {
    email: deleted ? "" : normalizeIdentityEmail(user.email),
    emailVerified: deleted ? false : user.emailVerified,
    ...(deleted ? { deletedAt: Date.now() } : {}),
  };
  if (existing) {
    await ctx.db.patch("users", existing._id, profile);
    return existing._id;
  }
  return ctx.db.insert("users", { teakUserId: user._id, ...profile });
};
