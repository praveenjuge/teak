import { v } from "convex/values";
import { env, internalQuery, query } from "../_generated/server";

// Internal, read-only Phase R probe. It does not change the active provider.
export const authPrimary = internalQuery({
  args: {},
  returns: v.union(v.literal("betterauth"), v.literal("workos")),
  handler: () => {
    const primary = env.AUTH_PRIMARY ?? "betterauth";
    if (primary !== "betterauth" && primary !== "workos") {
      throw new Error("AUTH_PRIMARY must be betterauth or workos");
    }
    return primary;
  },
});

// Phase R has no vault access or mapping writes. Only the managed dev environment
// can expose this authenticated transport probe.
export const identity = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      subject: v.string(),
      issuer: v.string(),
      externalId: v.union(v.string(), v.null()),
      emailVerified: v.boolean(),
      sid: v.string(),
    })
  ),
  handler: async (ctx) => {
    if (
      env.WORKOS_ENVIRONMENT_ID !== "environment_01KBYSVN9RVQ1JXACG3MDMQZGA"
    ) {
      return null;
    }
    const user = await ctx.auth.getUserIdentity();
    if (
      !user ||
      typeof user.sid !== "string" ||
      !user.sid.startsWith("session_") ||
      user.issuer !==
        "https://api.workos.com/user_management/client_01KBYSVNVDV2G39REZFGF0K7GD"
    ) {
      return null;
    }
    return {
      subject: user.subject,
      issuer: user.issuer,
      externalId:
        typeof user.external_id === "string" ? user.external_id : null,
      emailVerified: user.email_verified === true,
      sid: user.sid,
    };
  },
});
