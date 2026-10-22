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
