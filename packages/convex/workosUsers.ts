import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
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

const reasonValidator = v.union(
  v.literal("workos_deleted_user"),
  v.literal("email_unverified"),
  v.literal("profile_pending"),
  v.literal("signups_frozen")
);
type LinkReason = typeof reasonValidator.type;

const EMAIL_HOLDER_ROWS = 20;

// A deleted account keeps its row and address; only a live owner holds it, or
// an address someone used before deleting an account would stay stuck.
export const emailHeldByLiveOwner = async (
  ctx: Pick<MutationCtx, "db">,
  email: string
) => {
  const holders = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .order("desc")
    .take(EMAIL_HOLDER_ROWS);
  return holders.some(
    (holder) =>
      holder.deletedAt === undefined && holder.workosDeletedAt === undefined
  );
};

// A signed session says WorkOS verified its current address, so the owner
// row takes the verification, the name and, when no live owner holds it, the
// address.
const syncOwnerFromClaims = async (
  ctx: MutationCtx,
  owner: Doc<"users">,
  email: string,
  name: string | undefined
) => {
  if (
    owner.deletedAt !== undefined ||
    owner.workosDeletedAt !== undefined ||
    owner.deletionStartedAt !== undefined
  ) {
    return;
  }
  const patch: Partial<Pick<Doc<"users">, "email" | "emailVerified" | "name">> =
    {};
  if (!owner.emailVerified) {
    patch.emailVerified = true;
  }
  if (name && owner.name !== name) {
    patch.name = name;
  }
  if (
    owner.email !== email &&
    isStorableEmail(email) &&
    !(await emailHeldByLiveOwner(ctx, email))
  ) {
    patch.email = email;
  }
  if (Object.keys(patch).length) {
    await ctx.db.patch("users", owner._id, patch);
  }
};

// Links a WorkOS user to the Teak owner that already carries its ID, or
// creates a new owner when sign-ups are open and WorkOS has verified the
// email. The resolver (`workosIdentity.ts`) still decides whether a linked
// owner may sign in.
export const linkWorkosUser = internalMutation({
  args: {
    workosUserId: v.string(),
    email: v.string(),
    emailVerified: v.boolean(),
    name: v.optional(v.string()),
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
    const hasControls = (value: string) =>
      [...value].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      );
    const validId = (id: string) =>
      id.length > 0 && id.length <= 256 && !/\s/.test(id) && !hasControls(id);
    if (
      !(validId(args.workosUserId) && email) ||
      email.length > 320 ||
      hasControls(email)
    ) {
      throw new Error("Invalid WorkOS linking input");
    }
    const quarantine = (reason: LinkReason) => ({
      status: "quarantined" as const,
      reason,
    });
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
      return quarantine("workos_deleted_user");
    }
    if (linked) {
      if (args.source === "ensureUser" && args.emailVerified) {
        await syncOwnerFromClaims(ctx, linked, email, args.name);
      }
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
    // Sign-in's signed session claims are enough on their own; a webhook
    // event must match the AuthKit component's stored profile.
    const provider =
      args.source === "webhook"
        ? await readComponentUser(ctx, args.workosUserId)
        : null;
    if (
      args.source === "webhook" &&
      (provider === null ||
        normalizeIdentityEmail(provider.email) !== email ||
        provider.emailVerified !== true)
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
      ...(args.name ? { name: args.name } : {}),
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
    return { status: "linked" as const, teakUserId, changed: true };
  },
});
