import { v } from "convex/values";

export const disconnectRecoveryReceipt = v.object({
  operationId: v.string(),
  snapshotDigest: v.string(),
  approvalReference: v.string(),
  evidenceKind: v.union(
    v.literal("preserved-204"),
    v.literal("provider-written-confirmation")
  ),
  evidenceReference: v.string(),
  originalRequestId: v.string(),
  cloudUrl: v.string(),
  siteUrl: v.string(),
  environmentId: v.string(),
  authKitClientId: v.string(),
  authKitDomain: v.string(),
  credentialFingerprint: v.string(),
  applicationId: v.string(),
  recordedAt: v.number(),
});

// Rows written before account deletion stopped binding to a WorkOS
// environment still carry these (`.agents/sunset.md`).
export const workosDeletionTargetValidator = v.object({
  environmentId: v.string(),
  clientId: v.string(),
  issuer: v.string(),
  credentialFingerprint: v.string(),
});
export const workosDeletionCompletionValidator = v.object({
  version: v.literal(1),
  stateId: v.id("accountDeletionStates"),
  generation: v.number(),
  workosUserId: v.string(),
  startedAt: v.number(),
  completedAt: v.number(),
  target: workosDeletionTargetValidator,
});
