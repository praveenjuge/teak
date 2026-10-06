import { v } from "convex/values";
import { env, internalQuery, query } from "../_generated/server";
import { getReadinessIdentity } from "../securitySessions";

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
  handler: getReadinessIdentity,
});
