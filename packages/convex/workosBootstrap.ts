import type { FunctionReturnType } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation } from "./_generated/server";
import { getWorkosBootstrapIdentity } from "./securitySessions";
import { isStorableEmail, normalizeIdentityEmail } from "./shared/workosIds";

const bootstrapResult = v.union(
  v.object({ status: v.literal("ok"), teakUserId: v.string() }),
  v.object({ status: v.literal("verify_email") }),
  v.object({ status: v.literal("frozen") }),
  v.object({ status: v.literal("quarantined"), reason: v.string() })
);

export const ensureUser = mutation({
  args: {},
  returns: bootstrapResult,
  handler: async (ctx) => {
    const identity = await getWorkosBootstrapIdentity(ctx);
    if (!identity) {
      return { status: "quarantined" as const, reason: "invalid_session" };
    }
    if (!identity.emailVerified) {
      return { status: "verify_email" as const };
    }
    const email = normalizeIdentityEmail(identity.email ?? "");
    if (!isStorableEmail(email)) {
      return { status: "quarantined" as const, reason: "invalid_profile" };
    }
    const linked: FunctionReturnType<
      typeof internal.workosUsers.linkWorkosUser
    > = await ctx.runMutation(internal.workosUsers.linkWorkosUser, {
      workosUserId: identity.workosUserId,
      email,
      ...(identity.name ? { name: identity.name } : {}),
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
      verification: { kind: "session", emailVerified: identity.emailVerified },
    });
    return resolved.status === "ok"
      ? resolved
      : { status: "quarantined" as const, reason: resolved.reason };
  },
});
