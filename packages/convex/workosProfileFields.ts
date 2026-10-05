import { v } from "convex/values";

// A missing profile permits a terminal tombstone for an unknown provider user.
// It never represents verification or grants access.
export const workosProfileValidator = v.object({
  email: v.string(),
  emailVerified: v.boolean(),
  externalId: v.union(v.string(), v.null()),
  firstName: v.union(v.string(), v.null()),
  lastName: v.union(v.string(), v.null()),
  profilePictureUrl: v.union(v.string(), v.null()),
});

export const workosProfileFields = {
  workosUserId: v.string(),
  teakUserId: v.optional(v.string()),
  profile: v.optional(workosProfileValidator),
  providerUpdatedAt: v.optional(v.string()),
  revision: v.number(),
  source: v.union(v.literal("event"), v.literal("reconciliation")),
  reconciliationRunId: v.optional(v.id("workosReconciliationRuns")),
  lastEventAt: v.optional(v.number()),
  deletedAt: v.optional(v.number()),
  deletionSource: v.optional(
    v.union(v.literal("event"), v.literal("reconciliation_not_found"))
  ),
};

export const workosReconciliationRunFields = {
  runId: v.string(),
  environmentId: v.string(),
  clientId: v.string(),
  providerWitnessUserId: v.string(),
  apiKeyFingerprint: v.string(),
  mode: v.union(v.literal("audit"), v.literal("repair")),
  generation: v.number(),
  leaseUntil: v.number(),
  phase: v.union(
    v.literal("events"),
    v.literal("provider"),
    v.literal("owners"),
    v.literal("complete"),
    v.literal("failed")
  ),
  eventCursor: v.optional(v.string()),
  rangeStart: v.string(),
  rangeEnd: v.string(),
  providerCursor: v.optional(v.string()),
  ownerCursor: v.optional(v.string()),
  scanned: v.number(),
  drifted: v.optional(v.number()),
  auditEvidence: v.optional(v.array(v.object({ workosUserId: v.string(), reasons: v.array(v.string()) }))),
  repaired: v.number(),
  quarantined: v.number(),
  deleted: v.number(),
  startedAt: v.number(),
  updatedAt: v.number(),
  nextAttemptAt: v.optional(v.number()),
  retryCount: v.number(),
  failureReason: v.optional(v.string()),
};
