import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import {
  logResolverDenial,
  type ResolverDenialReason,
  type ResolverVerification,
} from "./authMonitoring";
import { readComponentUser } from "./securitySessions";
import { hasWorkosDeletionReceipt } from "./workos/deletionCompletion";
import { type ProviderProfile, toProviderProfile } from "./workosProfileRead";

export interface ResolveArgs {
  externalId?: string | null;
  verification: ResolverVerification;
  workosUserId: string;
}

export type ResolvedOwner =
  | { status: "ok"; teakUserId: string; profile: ProviderProfile }
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

// A WorkOS deletion receipt is authoritative for every mapped row.
export const resolveWorkosOwner = internalQuery({
  args: {
    workosUserId: v.string(),
    externalId: v.optional(v.union(v.string(), v.null())),
    verification: v.union(
      v.object({ kind: v.literal("session"), emailVerified: v.boolean() }),
      v.object({ kind: v.literal("connect") })
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
        v.literal("external_id_mismatch"),
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
  if (await hasWorkosDeletionReceipt(ctx, args.workosUserId)) {
    return {
      status: "denied" as const,
      reason: "workos_deleted_user" as const,
    };
  }
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
  const owners = await ctx.db
    .query("users")
    .withIndex("by_teakUserId", (q) => q.eq("teakUserId", row.teakUserId))
    .take(2);
  if (owners.length !== 1) {
    return {
      status: "denied" as const,
      reason: "duplicate_mapping" as const,
    };
  }
  if (
    args.externalId !== undefined &&
    args.externalId !== null &&
    args.externalId !== row.teakUserId
  ) {
    console.warn("identity_resolver_mismatch", {
      provider: "workos",
      reason: "external_id_mismatch",
    });
    return {
      status: "denied" as const,
      reason: "external_id_mismatch" as const,
    };
  }
  const user = await readComponentUser(ctx, args.workosUserId);
  const profile = user ? toProviderProfile(args.workosUserId, user) : null;
  if (
    profile?.externalId !== undefined &&
    profile.externalId !== null &&
    profile.externalId !== row.teakUserId
  ) {
    return {
      status: "denied" as const,
      reason: "external_id_mismatch" as const,
    };
  }
  if (
    !profile?.emailVerified ||
    (args.verification.kind === "session" &&
      args.verification.emailVerified !== true)
  ) {
    return { status: "denied" as const, reason: "verify_email" as const };
  }
  return { status: "ok" as const, teakUserId: row.teakUserId, profile };
};
