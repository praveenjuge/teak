import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { readSignupsDisabled } from "./env";
import { readComponentUser } from "./securitySessions";
import {
  isStorableEmail,
  normalizeIdentityEmail,
  WORKOS_USER_ID,
} from "./shared/workosIds";
import { scheduleUserCreated } from "./telemetry/schedule";

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

// One open receipt per WorkOS user and reason. Resolution matches on that pair,
// so repeated denials (a client retrying ensureUser) add nothing new.
export const recordQuarantine = async (
  ctx: MutationCtx,
  row: {
    workosUserId: string;
    teakUserId?: string;
    email: string;
    reason: string;
    source: string;
  }
) => {
  const open = await ctx.db
    .query("migrationQuarantine")
    .withIndex("by_workosUserId_and_reason_and_resolvedAt", (q) =>
      q
        .eq("workosUserId", row.workosUserId)
        .eq("reason", row.reason)
        .eq("resolvedAt", undefined)
    )
    .first();
  if (!open) {
    await ctx.db.insert("migrationQuarantine", {
      ...row,
      createdAt: Date.now(),
    });
  }
};

// A successful link answers the earlier "not yet" receipts for this WorkOS user.
// Conflict receipts stay open for an operator.
const PENDING_REASONS = [
  "missing_mapping",
  "signups_frozen",
  "email_unverified",
  "profile_pending",
] as const;
const resolvePendingReceipts = async (
  ctx: MutationCtx,
  workosUserId: string
) => {
  for (const reason of PENDING_REASONS) {
    const open = await ctx.db
      .query("migrationQuarantine")
      .withIndex("by_workosUserId_and_reason_and_resolvedAt", (q) =>
        q
          .eq("workosUserId", workosUserId)
          .eq("reason", reason)
          .eq("resolvedAt", undefined)
      )
      .take(100);
    for (const receipt of open) {
      await ctx.db.patch("migrationQuarantine", receipt._id, {
        resolvedAt: Date.now(),
      });
    }
  }
};

// Only authenticated provider adapters may call this internal boundary.
// It links existing owners; only proven bootstrap/created-event adapters may
// allocate a new permanent owner when the shared signup policy permits it.
// All uniqueness reads and the one link write share the mutation transaction.
export const linkWorkosUser = internalMutation({
  args: {
    workosUserId: v.string(),
    externalId: v.optional(v.union(v.string(), v.null())),
    email: v.string(),
    emailVerified: v.boolean(),
    source: v.union(v.literal("webhook"), v.literal("ensureUser")),
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
      await recordQuarantine(ctx, {
        workosUserId: args.workosUserId,
        ...(teakUserId === undefined ? {} : { teakUserId }),
        email,
        reason,
        source: args.source,
      });
      return { status: "quarantined" as const, reason };
    };
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
    if (
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
        if (readSignupsDisabled()) {
          return quarantine("signups_frozen");
        }
        if (
          !(WORKOS_USER_ID.test(args.workosUserId) && isStorableEmail(email))
        ) {
          throw new Error("Invalid WorkOS creation input");
        }
        // A new owner needs the component's current, verified profile for this
        // exact address, not yet bound to another owner.
        const provider = await readComponentUser(ctx, args.workosUserId);
        const currentVerifiedProfile =
          provider !== null &&
          normalizeIdentityEmail(provider.email) === email &&
          provider.emailVerified === true &&
          (provider.externalId ?? null) === null;
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
            provider?.emailVerified === false
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
        await resolvePendingReceipts(ctx, args.workosUserId);
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
      // The WorkOS component holds the profile; linking only binds the owner.
      await ctx.db.patch("users", candidate._id, {
        workosUserId: args.workosUserId,
      });
    }
    await resolvePendingReceipts(ctx, args.workosUserId);
    return {
      status: "linked" as const,
      teakUserId: candidate.teakUserId,
      changed,
    };
  },
});
