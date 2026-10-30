import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import {
  logResolverDenial,
  type ResolverDenialReason,
  type ResolverVerification,
} from "./authMonitoring";
import { readComponentUser } from "./securitySessions";
import { type ProviderProfile, toProviderProfile } from "./workosProfileRead";

export interface ResolveArgs {
  verification: ResolverVerification;
  workosUserId: string;
}

export type ResolvedOwner =
  | { status: "ok"; teakUserId: string; profile: ProviderProfile | null }
  | { status: "denied"; reason: ResolverDenialReason };

export async function resolveOwner(
  ctx: Pick<QueryCtx, "db" | "runQuery">,
  args: ResolveArgs
): Promise<ResolvedOwner> {
  const result = await resolve(ctx, args);
  if (result.status === "denied") {
    await logResolverDenial({
      reason: result.reason,
      verification: args.verification,
      workosUserId: args.workosUserId,
    });
  }
  return result;
}

export const resolveWorkosOwner = internalQuery({
  args: {
    workosUserId: v.string(),
    verification: v.union(
      v.object({ kind: v.literal("session"), emailVerified: v.boolean() }),
      v.object({ kind: v.literal("connect") }),
      v.object({ kind: v.literal("stored") })
    ),
  },
  returns: v.union(
    v.object({ status: v.literal("ok"), teakUserId: v.string() }),
    v.object({
      status: v.literal("denied"),
      reason: v.union(
        v.literal("missing_mapping"),
        v.literal("duplicate_mapping"),
        v.literal("deleted_user"),
        v.literal("workos_deleted_user"),
        v.literal("deleting_user"),
        v.literal("verify_email")
      ),
    })
  ),
  handler: async (ctx, args) => {
    const result = await resolveOwner(ctx, args);
    return result.status === "ok"
      ? { status: "ok" as const, teakUserId: result.teakUserId }
      : result;
  },
});

const resolve = async (
  ctx: Pick<QueryCtx, "db" | "runQuery">,
  args: ResolveArgs
): Promise<ResolvedOwner> => {
  const rows = await ctx.db
    .query("users")
    .withIndex("by_workosUserId", (q) =>
      q.eq("workosUserId", args.workosUserId)
    )
    .take(2);
  if (rows.length !== 1) {
    return {
      status: "denied" as const,
      reason: rows.length
        ? ("duplicate_mapping" as const)
        : ("missing_mapping" as const),
    };
  }
  const row = rows[0];
  if (row.deletedAt !== undefined || row.workosDeletedAt !== undefined) {
    return {
      status: "denied" as const,
      reason:
        row.deletedAt === undefined
          ? ("workos_deleted_user" as const)
          : ("deleted_user" as const),
    };
  }
  const deletion = await ctx.db
    .query("accountDeletionStates")
    .withIndex("by_userId", (q) => q.eq("userId", row.teakUserId))
    .first();
  if (deletion) {
    return { status: "denied" as const, reason: "deleting_user" as const };
  }
  // Two rows sharing an owner would let two WorkOS users into one vault.
  const owners = await ctx.db
    .query("users")
    .withIndex("by_teakUserId", (q) => q.eq("teakUserId", row.teakUserId))
    .take(2);
  if (owners.length !== 1) {
    return { status: "denied" as const, reason: "duplicate_mapping" as const };
  }
  // A session token carries its own signed email verification, and a stored
  // owner was created from a verified one, so both need the webhook's copy of
  // the profile only to see a newer unverified address. A Connect token
  // carries none and needs the profile.
  const user = await readComponentUser(ctx, args.workosUserId);
  const profile = user ? toProviderProfile(args.workosUserId, user) : null;
  const { verification } = args;
  if (
    verification.kind === "connect"
      ? profile?.emailVerified !== true
      : profile?.emailVerified === false ||
        (verification.kind === "session" && verification.emailVerified !== true)
  ) {
    return { status: "denied" as const, reason: "verify_email" as const };
  }
  return { status: "ok" as const, teakUserId: row.teakUserId, profile };
};
