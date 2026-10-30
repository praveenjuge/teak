import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
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

// Links a WorkOS user to the Teak owner that already carries its ID, or
// creates a new owner when sign-ups are open and WorkOS has verified the
// email. The resolver (`workosIdentity.ts`) still decides whether a linked
// owner may sign in.
export const linkWorkosUser = internalMutation({
  args: {
    workosUserId: v.string(),
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
    // Once the webhook has stored the AuthKit component's copy of the
    // profile, it is the newest evidence: the same address, verified. Before
    // that, sign-in's signed session claims are enough on their own.
    const provider = await readComponentUser(ctx, args.workosUserId);
    if (
      provider === null
        ? args.source !== "ensureUser"
        : normalizeIdentityEmail(provider.email) !== email ||
          provider.emailVerified !== true
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
    return { status: "linked" as const, teakUserId, changed: true };
  },
});
