import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { readCanonicalWorkosProfile } from "./workosProfileRead";

// Only callers that have verified the token's issuer, signature, audience,
// user subject and session/consent may use this read-only ownership boundary.
// The provider deletion ledger is authoritative for every mapped row.
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
    const deleted = await ctx.db
      .query("workosEvents")
      .withIndex("by_workosUserId_and_type", (q) =>
        q.eq("workosUserId", args.workosUserId).eq("type", "user.deleted")
      )
      .first();
    if (deleted) {
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
    const canonical = await readCanonicalWorkosProfile(ctx, args.workosUserId);
    if (
      canonical?.profile?.emailVerified !== true ||
      (canonical.teakUserId !== undefined &&
        canonical.teakUserId !== row.teakUserId)
    ) {
      return { status: "denied" as const, reason: "verify_email" as const };
    }
    const verified =
      args.verification.kind === "session"
        ? args.verification.emailVerified === true
        : row.workosEmailVerified === true;
    if (!verified) {
      return { status: "denied" as const, reason: "verify_email" as const };
    }
    return { status: "ok" as const, teakUserId: row.teakUserId };
  },
});
