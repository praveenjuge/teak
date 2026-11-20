import type { FunctionReturnType } from "convex/server";
import { type ObjectType, v } from "convex/values";
import { internal } from "./_generated/api";
import { type MutationCtx, mutation } from "./_generated/server";
import { getWorkosBootstrapIdentity } from "./securitySessions";
import { isStorableEmail, normalizeIdentityEmail } from "./shared/workosIds";
import { signupContextArgs } from "./workosUsers";

export const bootstrapResult = v.union(
  v.object({ status: v.literal("ok"), teakUserId: v.string() }),
  v.object({ status: v.literal("verify_email") }),
  v.object({ status: v.literal("frozen") }),
  v.object({ status: v.literal("quarantined"), reason: v.string() })
);

type SignupContext = ObjectType<typeof signupContextArgs>;

const bootstrap = async (
  ctx: MutationCtx,
  signup: SignupContext
): Promise<typeof bootstrapResult.type> => {
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
  const linked: FunctionReturnType<typeof internal.workosUsers.linkWorkosUser> =
    await ctx.runMutation(internal.workosUsers.linkWorkosUser, {
      workosUserId: identity.workosUserId,
      email,
      ...(identity.name ? { name: identity.name } : {}),
      ...signup,
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
};

/** Links or creates the signed-in owner. Takes no arguments, as every app sent. */
export const ensureUser = mutation({
  args: {},
  returns: bootstrapResult,
  handler: (ctx) => bootstrap(ctx, {}),
});

/**
 * `ensureUser` that also says where a new account signed up, for its
 * `user_signed_up`. A separate function, not new `ensureUser` arguments,
 * because the backend and the apps deploy in either order: a backend that
 * predates it answers "Could not find public function", and the app falls
 * back to `ensureUser`, where old arguments would have been refused.
 */
export const ensureUserWithSignup = mutation({
  args: signupContextArgs,
  returns: bootstrapResult,
  handler: (ctx, signup) => bootstrap(ctx, signup),
});
