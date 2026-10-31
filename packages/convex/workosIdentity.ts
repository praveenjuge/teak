import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import {
  logResolverDenial,
  type ResolverDenialReason,
  type ResolverVerification,
} from "./authMonitoring";

export interface ResolveArgs {
  verification: ResolverVerification;
  workosUserId: string;
}

export type ResolvedOwner =
  | { status: "ok"; teakUserId: string }
  | { status: "denied"; reason: ResolverDenialReason };

export async function resolveOwner(
  ctx: Pick<QueryCtx, "db">,
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
  handler: (ctx, args) => resolveOwner(ctx, args),
});

// Every signed-in call runs this, so it reads one row: the owner's mapping,
// which also carries its deletion and the WorkOS address's verification. A
// Teak owner ID is unique by construction (`teak_<row id>`).
const resolve = async (
  ctx: Pick<QueryCtx, "db">,
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
  if (row.deletionStartedAt !== undefined) {
    return { status: "denied" as const, reason: "deleting_user" as const };
  }
  // A session token carries its own signed verification. A Connect token
  // carries none, so it needs the stored address verified.
  const { verification } = args;
  if (
    verification.kind === "connect"
      ? row.emailVerified !== true
      : row.emailVerified === false ||
        (verification.kind === "session" && verification.emailVerified !== true)
  ) {
    return { status: "denied" as const, reason: "verify_email" as const };
  }
  return { status: "ok" as const, teakUserId: row.teakUserId };
};
