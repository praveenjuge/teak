import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { readSignupsPaused } from "./adminAccess";
import { startVaultSetup } from "./card/defaultCards";
import { readComponentUser } from "./securitySessions";
import {
  isStorableEmail,
  normalizeIdentityEmail,
  WORKOS_USER_ID,
} from "./shared/workosIds";
import { queueUserCreated } from "./telemetry/schedule";
import { hasWorkosDeletionReceipt } from "./workos/deletionCompletion";

// `linkWorkosUser` writes only these. Older receipts keep the reasons the
// WorkOS migration wrote, and the admin views read them as plain strings.
const reasonValidator = v.union(
  v.literal("workos_deleted_user"),
  v.literal("external_id_mismatch"),
  v.literal("email_unverified"),
  v.literal("profile_pending"),
  v.literal("signups_frozen")
);
type LinkReason = typeof reasonValidator.type;

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

// A link or a new owner closes these. `missing_mapping` receipts were written
// before new owners could be created from WorkOS, and close the same way.
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

// Links a WorkOS user to the Teak owner that already carries its ID, or
// creates a new owner when sign-ups are open and WorkOS has verified the
// email. The resolver (`workosIdentity.ts`) still decides whether a linked
// owner may sign in.
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
    const linked = await ctx.db
      .query("users")
      .withIndex("by_workosUserId", (q) =>
        q.eq("workosUserId", args.workosUserId)
      )
      .first();
    // A deleted WorkOS user never gets an owner back, even from a late event.
    if (
      linked?.workosDeletedAt !== undefined ||
      (await hasWorkosDeletionReceipt(ctx, args.workosUserId))
    ) {
      return quarantine("workos_deleted_user", linked?.teakUserId);
    }
    // An external ID names the owner this WorkOS user belongs to. It must be
    // the linked owner; a new owner would never resolve.
    if (externalId !== undefined && externalId !== linked?.teakUserId) {
      return quarantine("external_id_mismatch", externalId);
    }
    if (linked) {
      await resolvePendingReceipts(ctx, args.workosUserId);
      return {
        status: "linked" as const,
        teakUserId: linked.teakUserId,
        changed: false,
      };
    }
    if (!args.emailVerified) {
      return quarantine("email_unverified");
    }
    if (await readSignupsPaused(ctx)) {
      return quarantine("signups_frozen");
    }
    if (!(WORKOS_USER_ID.test(args.workosUserId) && isStorableEmail(email))) {
      throw new Error("Invalid WorkOS creation input");
    }
    // The AuthKit component's copy of the profile is the evidence a new owner
    // needs: the same address, verified, and not bound to another owner.
    const provider = await readComponentUser(ctx, args.workosUserId);
    if (
      provider === null ||
      normalizeIdentityEmail(provider.email) !== email ||
      provider.emailVerified !== true ||
      (provider.externalId ?? null) !== null
    ) {
      return quarantine(
        provider?.emailVerified === false
          ? "email_unverified"
          : "profile_pending"
      );
    }
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
    await startVaultSetup(ctx, teakUserId);
    await ctx.scheduler.runAfter(
      0,
      internal.card.defaultCards.createDefaultCardsForUser,
      { userId: teakUserId }
    );
    await queueUserCreated(ctx, {
      email,
      source: "auth",
      userId: teakUserId,
    });
    await resolvePendingReceipts(ctx, args.workosUserId);
    return { status: "linked" as const, teakUserId, changed: true };
  },
});
