import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { readAuthPrimary, readSignupsDisabled } from "./env";
import { guardUserCreation } from "./signupFreeze";
import { scheduleUserCreated } from "./telemetry/schedule";
import { normalizeIdentityEmail } from "./userIdentityTable";

const reasonValidator = v.union(
  v.literal("external_id_mismatch"),
  v.literal("missing_mapping"),
  v.literal("signups_frozen"),
  v.literal("equal_timestamp_conflict"),
  v.literal("duplicate_mapping"),
  v.literal("link_conflict"),
  v.literal("deleted_user"),
  v.literal("workos_deleted_user"),
  v.literal("deleting_user"),
  v.literal("email_unverified"),
  v.literal("ambiguous_email"),
  v.literal("profile_pending")
);
type LinkReason = typeof reasonValidator.type;

// Only authenticated provider/import adapters may call this internal boundary.
// It links existing owners; only proven bootstrap/created-event adapters may
// allocate a new permanent owner when the shared signup policy permits it.
// All uniqueness reads and the one link write share the mutation transaction.
export const linkWorkosUser = internalMutation({
  args: {
    allowCreate: v.optional(v.boolean()),
    workosUserId: v.string(),
    externalId: v.optional(v.union(v.string(), v.null())),
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
    const externalId = args.externalId ?? undefined;
    const hasControls = (value: string) =>
      [...value].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      );
    const validId = (id: string) =>
      id.length > 0 && id.length <= 256 && !/\s/.test(id) && !hasControls(id);
    if (
      !validId(args.workosUserId) ||
      (externalId !== undefined && !validId(externalId)) ||
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
    // A reserved E2E provider identity stamped for ownerless deletion never
    // gains a Teak owner. Reading the lease in this transaction serializes
    // owner creation and linking with the cleanup stamp.
    const reserved = await ctx.db
      .query("e2eSignupReservations")
      .withIndex("by_workosUserId", (q) =>
        q.eq("workosUserId", args.workosUserId)
      )
      .take(2);
    if (reserved.some((row) => row.ownerlessDeletionAt !== undefined)) {
      return quarantine("deleting_user");
    }
    const providerRows = await ctx.db
      .query("users")
      .withIndex("by_workosUserId", (q) =>
        q.eq("workosUserId", args.workosUserId)
      )
      .take(2);
    const linked = providerRows[0];
    const providerDeletion = await ctx.db
      .query("workosEvents")
      .withIndex("by_workosUserId_and_type", (q) =>
        q.eq("workosUserId", args.workosUserId).eq("type", "user.deleted")
      )
      .first();
    const providerStates = await ctx.db
      .query("workosProfiles")
      .withIndex("by_workosUserId", (q) =>
        q.eq("workosUserId", args.workosUserId)
      )
      .take(2);
    if (providerStates.length > 1) {
      return quarantine("duplicate_mapping");
    }
    if (
      providerStates[0]?.deletedAt !== undefined ||
      providerDeletion ||
      providerRows.some((row) => row.workosDeletedAt !== undefined)
    ) {
      return quarantine("workos_deleted_user", linked?.teakUserId);
    }
    if (providerRows.length > 1) {
      return quarantine("duplicate_mapping");
    }
    let candidate: Doc<"users"> | undefined;
    if (externalId !== undefined) {
      const ownerRows = await ctx.db
        .query("users")
        .withIndex("by_teakUserId", (q) => q.eq("teakUserId", externalId))
        .take(2);
      if (ownerRows.length > 1) {
        return quarantine("duplicate_mapping", externalId);
      }
      candidate = ownerRows[0];
      if (!candidate || (linked && linked._id !== candidate._id)) {
        return quarantine("external_id_mismatch", externalId);
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
        const canCreate =
          args.allowCreate === true &&
          (args.source === "ensureUser" || args.source === "webhook") &&
          readAuthPrimary() === "workos";
        if (!canCreate) {
          return quarantine("missing_mapping");
        }
        try {
          await guardUserCreation({
            email,
            disabled: readSignupsDisabled(),
            e2eEmailDomain: process.env.E2E_EMAIL_DOMAIN,
          });
        } catch {
          return quarantine("signups_frozen");
        }
        if (
          !(
            /^user_[A-Za-z0-9]+$/.test(args.workosUserId) &&
            /^[^\s@]+@[^\s@]+$/.test(email)
          )
        ) {
          throw new Error("Invalid WorkOS creation input");
        }
        const canonical = await ctx.db
          .query("workosProfiles")
          .withIndex("by_workosUserId", (q) =>
            q.eq("workosUserId", args.workosUserId)
          )
          .take(2);
        const provider = canonical.length === 1 ? canonical[0] : undefined;
        const currentVerifiedProfile =
          provider?.deletedAt === undefined &&
          provider?.providerUpdatedAt !== undefined &&
          provider.profile?.email === email &&
          provider.profile.emailVerified === true &&
          provider.profile.externalId === null;
        for (const reason of [
          "equal_timestamp_conflict",
          "duplicate_mapping",
          "external_id_mismatch",
          "link_conflict",
        ] as const) {
          const conflict = await ctx.db
            .query("migrationQuarantine")
            .withIndex("by_workosUserId_and_reason_and_resolvedAt", (q) =>
              q
                .eq("workosUserId", args.workosUserId)
                .eq("reason", reason)
                .eq("resolvedAt", undefined)
            )
            .first();
          if (conflict) {
            return quarantine(reason);
          }
        }
        if (!currentVerifiedProfile) {
          return quarantine(
            provider?.profile?.emailVerified === false
              ? "email_unverified"
              : "profile_pending"
          );
        }
        // Allocate the permanent key from Convex's unique document identifier.
        // The placeholder and final key commit atomically; no caller can observe
        // or authorize against the placeholder between these writes.
        const ownerId = await ctx.db.insert("users", {
          teakUserId: "",
          identityOrigin: "workos",
          email,
          emailVerified: true,
          workosUserId: args.workosUserId,
          workosEmail: email,
          workosEmailVerified: true,
          ...(provider?.lastEventAt === undefined
            ? {}
            : { lastWorkosEventAt: provider.lastEventAt }),
        });
        const teakUserId = `teak_${ownerId}`;
        const collision = await ctx.db
          .query("users")
          .withIndex("by_teakUserId", (q) => q.eq("teakUserId", teakUserId))
          .first();
        if (collision) {
          throw new Error("Permanent Teak owner collision");
        }
        await ctx.db.patch("users", ownerId, { teakUserId });
        await ctx.scheduler.runAfter(
          0,
          internal.card.defaultCards.createDefaultCardsForUser,
          { userId: teakUserId }
        );
        await scheduleUserCreated(ctx, { source: "auth", userId: teakUserId });
        return { status: "linked" as const, teakUserId, changed: true };
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
    if (candidate.workosDeletedAt !== undefined) {
      return quarantine("workos_deleted_user", candidate.teakUserId);
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
      // Linking must never overwrite either provider profile.
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
