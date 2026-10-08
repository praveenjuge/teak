import type { FunctionReturnType } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation } from "./_generated/server";
import {
  getWorkosBootstrapIdentity,
  readWorkosProfile,
} from "./securitySessions";
import { normalizeIdentityEmail } from "./userIdentityTable";
import { validWorkosExternalId } from "./workosTokens";
import { recordQuarantine } from "./workosUsers";

// Signed session proof is checked before linking: a new user has no owner yet.
// Expected denials return normally so the linker's quarantine writes commit.
export const ensureUser = mutation({
  args: {},
  returns: v.union(
    v.object({ status: v.literal("ok"), teakUserId: v.string() }),
    v.object({ status: v.literal("verify_email") }),
    v.object({ status: v.literal("frozen") }),
    v.object({ status: v.literal("quarantined"), reason: v.string() })
  ),
  handler: async (ctx) => {
    const identity = await getWorkosBootstrapIdentity(ctx);
    if (!identity) {
      return { status: "quarantined" as const, reason: "invalid_session" };
    }
    if (!identity.emailVerified) {
      return { status: "verify_email" as const };
    }
    const profile = await readWorkosProfile(ctx, identity.workosUserId);
    if (!profile) {
      return { status: "quarantined" as const, reason: "profile_pending" };
    }
    if (profile.emailVerified !== true) {
      return { status: "verify_email" as const };
    }
    const email = normalizeIdentityEmail(profile.email);
    if (
      profile.id !== identity.workosUserId ||
      email.length > 320 ||
      !/^[^\s@]+@[^\s@]+$/.test(email) ||
      /\p{Cc}/u.test(email) ||
      !validWorkosExternalId(profile.externalId) ||
      (typeof profile.externalId === "string" &&
        /[\s\p{Cc}]/u.test(profile.externalId))
    ) {
      return { status: "quarantined" as const, reason: "invalid_profile" };
    }
    if (
      identity.externalId !== undefined &&
      identity.externalId !== null &&
      profile.externalId !== undefined &&
      profile.externalId !== null &&
      identity.externalId !== profile.externalId
    ) {
      await recordQuarantine(ctx, {
        workosUserId: identity.workosUserId,
        email,
        reason: "external_id_mismatch",
        source: "ensureUser",
      });
      return { status: "quarantined" as const, reason: "external_id_mismatch" };
    }
    const externalId = profile.externalId ?? identity.externalId;
    const linked: FunctionReturnType<
      typeof internal.workosUsers.linkWorkosUser
    > = await ctx.runMutation(internal.workosUsers.linkWorkosUser, {
      workosUserId: identity.workosUserId,
      email,
      emailVerified: true,
      ...(externalId === undefined || externalId === null
        ? {}
        : { externalId }),
      source: "ensureUser",
      allowCreate: true,
    });
    if (linked.status === "quarantined") {
      return linked.reason === "signups_frozen"
        ? { status: "frozen" as const }
        : linked;
    }
    const resolved: FunctionReturnType<
      typeof internal.workosIdentity.resolveWorkosOwner
    > = await ctx.runQuery(internal.workosIdentity.resolveWorkosOwner, {
      workosUserId: identity.workosUserId,
      ...(externalId === undefined || externalId === null
        ? {}
        : { externalId }),
      verification: { kind: "session", emailVerified: identity.emailVerified },
    });
    return resolved.status === "ok"
      ? resolved
      : { status: "quarantined" as const, reason: resolved.reason };
  },
});
