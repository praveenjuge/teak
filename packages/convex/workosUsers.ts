import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { normalizeIdentityEmail } from "./userIdentityTable";

const reasonValidator = v.union(
  v.literal("external_id_mismatch"),
  v.literal("missing_mapping"),
  v.literal("duplicate_mapping"),
  v.literal("link_conflict"),
  v.literal("deleted_user"),
  v.literal("deleting_user"),
  v.literal("email_unverified"),
  v.literal("ambiguous_email")
);
type LinkReason = typeof reasonValidator.type;

// Only authenticated provider/import adapters may call this internal boundary.
// It links existing owners, never grants authorization or creates a vault.
// All uniqueness reads and the one link write share the mutation transaction.
export const linkWorkosUser = internalMutation({
  args: {
    workosUserId: v.string(),
    externalId: v.optional(v.string()),
    email: v.string(),
    emailVerified: v.boolean(),
    source: v.union(
      v.literal("import"),
      v.literal("webhook"),
      v.literal("ensureUser"),
      v.literal("reconcile")
    ),
  },
  returns: v.union(
    v.object({
      status: v.literal("linked"),
      teakUserId: v.string(),
      changed: v.boolean(),
    }),
    v.object({ status: v.literal("quarantined"), reason: reasonValidator })
  ),
  handler: async (ctx, args) => {
    const email = normalizeIdentityEmail(args.email);
    const hasControls = (value: string) =>
      [...value].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      );
    const validId = (id: string) =>
      id.length > 0 && id.length <= 256 && !/\s/.test(id) && !hasControls(id);
    if (
      !validId(args.workosUserId) ||
      (args.externalId !== undefined && !validId(args.externalId)) ||
      !email ||
      email.length > 320 ||
      hasControls(email)
    ) {
      throw new Error("Invalid WorkOS linking input");
    }
    const quarantine = async (reason: LinkReason, teakUserId?: string) => {
      await ctx.db.insert("migrationQuarantine", {
        workosUserId: args.workosUserId,
        ...(teakUserId === undefined ? {} : { teakUserId }),
        email,
        reason,
        source: args.source,
        createdAt: Date.now(),
      });
      return { status: "quarantined" as const, reason };
    };
    const providerRows = await ctx.db
      .query("users")
      .withIndex("by_workosUserId", (q) =>
        q.eq("workosUserId", args.workosUserId)
      )
      .take(2);
    if (providerRows.length > 1) {
      return quarantine("duplicate_mapping");
    }
    const linked = providerRows[0];
    let candidate: Doc<"users"> | undefined;
    if (args.externalId !== undefined) {
      const externalId = args.externalId;
      const ownerRows = await ctx.db
        .query("users")
        .withIndex("by_teakUserId", (q) => q.eq("teakUserId", externalId))
        .take(2);
      if (ownerRows.length > 1) {
        return quarantine("duplicate_mapping", args.externalId);
      }
      candidate = ownerRows[0];
      if (!candidate || (linked && linked._id !== candidate._id)) {
        return quarantine("external_id_mismatch", args.externalId);
      }
    } else if (linked) {
      candidate = linked;
    } else {
      if (!args.emailVerified) {
        return quarantine("email_unverified");
      }
      const emailRows = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .take(2);
      if (emailRows.length > 1) {
        return quarantine("ambiguous_email");
      }
      candidate = emailRows[0];
      if (!candidate) {
        return quarantine("missing_mapping");
      }
      // A verified provider address must not claim a pre-existing unverified
      // legacy vault with surviving Better Auth credentials.
      if (!candidate.emailVerified) {
        return quarantine("email_unverified", candidate.teakUserId);
      }
    }
    if (candidate.deletedAt !== undefined) {
      return quarantine("deleted_user", candidate.teakUserId);
    }
    const deleting = await ctx.db
      .query("accountDeletionStates")
      .withIndex("by_userId", (q) => q.eq("userId", candidate.teakUserId))
      .take(1);
    if (deleting.length) {
      return quarantine("deleting_user", candidate.teakUserId);
    }
    if (
      candidate.workosUserId !== undefined &&
      candidate.workosUserId !== args.workosUserId
    ) {
      return quarantine("link_conflict", candidate.teakUserId);
    }
    const owners = await ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) =>
        q.eq("teakUserId", candidate.teakUserId)
      )
      .take(2);
    if (owners.length !== 1) {
      return quarantine("duplicate_mapping", candidate.teakUserId);
    }
    const changed = candidate.workosUserId !== args.workosUserId;
    if (changed) {
      // Ordered WorkOS profile synchronization belongs to the lifecycle handler.
      // Better Auth remains primary; do not overwrite its mirror in this slice.
      await ctx.db.patch("users", candidate._id, {
        workosUserId: args.workosUserId,
      });
    }
    return {
      status: "linked" as const,
      teakUserId: candidate.teakUserId,
      changed,
    };
  },
});
