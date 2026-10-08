import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { findWorkosConnectIssuer } from "./env";
import { sha256 } from "./publicApiHttpShared";
import { completeAcknowledged } from "./workosApplicationDisconnect";
import { workosCredentialFingerprint } from "./workosDeletionCompletion";

const pins = {
  cloudUrl: v.string(),
  siteUrl: v.string(),
  environmentId: v.string(),
  authKitClientId: v.string(),
  authKitDomain: v.string(),
  credentialFingerprint: v.string(),
};
const pinsValidator = v.object(pins);
const operation = {
  fenceId: v.id("workosApplicationDisconnects"),
  operationId: v.string(),
  userId: v.string(),
  workosUserId: v.string(),
  clientId: v.string(),
  applicationId: v.string(),
  triggerConsentId: v.string(),
  snapshotDigest: v.string(),
};
const evidence = v.object({
  kind: v.union(
    v.literal("preserved-204"),
    v.literal("provider-written-confirmation")
  ),
  reference: v.string(),
  originalRequestId: v.string(),
  originalDeletionCompleted: v.literal(true),
  noPendingOriginalRequest: v.literal(true),
});
const recoveryArgs = {
  ...pins,
  ...operation,
  approvalReference: v.string(),
  evidence,
};

const recoveryValidator = v.object(recoveryArgs);
function receipt(args: Infer<typeof recoveryValidator>, recordedAt: number) {
  return {
    operationId: args.operationId,
    snapshotDigest: args.snapshotDigest,
    approvalReference: args.approvalReference,
    evidenceKind: args.evidence.kind,
    evidenceReference: args.evidence.reference,
    originalRequestId: args.evidence.originalRequestId,
    cloudUrl: args.cloudUrl,
    siteUrl: args.siteUrl,
    environmentId: args.environmentId,
    authKitClientId: args.authKitClientId,
    authKitDomain: args.authKitDomain,
    credentialFingerprint: args.credentialFingerprint,
    applicationId: args.applicationId,
    recordedAt,
  };
}

async function assertPins(args: Infer<typeof pinsValidator>) {
  // Runtime pins are verified inside the transaction, never accepted as an
  // operator assertion. Recovery deliberately has no provider HTTP calls.
  const key = process.env.WORKOS_API_KEY;
  if (
    !key ||
    process.env.CONVEX_CLOUD_URL !== args.cloudUrl ||
    process.env.CONVEX_SITE_URL !== args.siteUrl ||
    process.env.WORKOS_ENVIRONMENT_ID !== args.environmentId ||
    process.env.WORKOS_CLIENT_ID !== args.authKitClientId ||
    findWorkosConnectIssuer() !== args.authKitDomain ||
    (await workosCredentialFingerprint(key)) !== args.credentialFingerprint
  ) {
    throw new Error("Disconnect recovery target mismatch");
  }
}
function digest(row: Doc<"workosApplicationDisconnects">) {
  return sha256(
    JSON.stringify(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))
  );
}
function reference(value: string) {
  return (
    value.length <= 2048 && value.trim().length > 0 && !/[\p{Cc}]/u.test(value)
  );
}
const inspection = v.object({
  ...operation,
  state: v.union(v.literal("unknown"), v.literal("dispatched")),
  ...pins,
});
// Privileged operator workflow: inspect, obtain separate runtime approval and
// positive evidence for the original request, then apply that exact proposal.
// A missing provider listing, elapsed time or HTTP error is never evidence.
export const inspect = internalQuery({
  args: { ...pins, fenceId: operation.fenceId },
  returns: v.union(v.null(), inspection),
  handler: async (ctx, args) => {
    await assertPins(args);
    const row = await ctx.db.get(args.fenceId);
    if (
      !(
        row &&
        ["unknown", "dispatched"].includes(row.state) &&
        row.applicationId
      )
    ) {
      return null;
    }
    if (
      row.environmentId !== args.environmentId ||
      row.authKitClientId !== args.authKitClientId ||
      row.authKitDomain !== args.authKitDomain ||
      row.credentialFingerprint !== args.credentialFingerprint
    ) {
      throw new Error("Disconnect recovery row target mismatch");
    }
    return {
      ...args,
      operationId: row.operationId,
      userId: row.userId,
      workosUserId: row.workosUserId,
      clientId: row.clientId,
      applicationId: row.applicationId,
      triggerConsentId: row.triggerConsentId,
      snapshotDigest: await digest(row),
      state: row.state as "unknown" | "dispatched",
    };
  },
});
export const acknowledgeConfirmed = internalMutation({
  args: recoveryArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertPins(args);
    if (
      !(
        reference(args.approvalReference) &&
        reference(args.evidence.reference) &&
        reference(args.evidence.originalRequestId) &&
        /^[a-f0-9]{64}$/.test(args.snapshotDigest)
      )
    ) {
      throw new Error(
        "Separate recovery approval and positive provider evidence required"
      );
    }
    const row = await ctx.db.get(args.fenceId);
    if (
      !row ||
      row.dispatchedAt === undefined ||
      row.operationId !== args.operationId ||
      row.userId !== args.userId ||
      row.workosUserId !== args.workosUserId ||
      row.clientId !== args.clientId ||
      row.applicationId !== args.applicationId ||
      row.triggerConsentId !== args.triggerConsentId ||
      row.environmentId !== args.environmentId ||
      row.authKitClientId !== args.authKitClientId ||
      row.authKitDomain !== args.authKitDomain ||
      row.credentialFingerprint !== args.credentialFingerprint
    ) {
      throw new Error("Disconnect recovery generation or snapshot changed");
    }
    if (row.state === "acknowledged" || row.state === "completed") {
      const previous = row.recoveryReceipt;
      if (
        !previous ||
        JSON.stringify(Object.entries(previous).sort()) !==
          JSON.stringify(
            Object.entries(receipt(args, previous.recordedAt)).sort()
          )
      ) {
        throw new Error("Disconnect recovery approval or evidence changed");
      }
      // A retry resumes only this already approved operation. It neither changes
      // the acknowledgement time nor acknowledges a newer generation.
      return null;
    }
    if (
      !["unknown", "dispatched"].includes(row.state) ||
      (await digest(row)) !== args.snapshotDigest
    ) {
      throw new Error("Disconnect recovery generation or snapshot changed");
    }
    const consents = await ctx.db
      .query("workosConsents")
      .withIndex("by_consentId", (q) => q.eq("consentId", row.triggerConsentId))
      .take(2);
    const consent = consents[0];
    if (
      consents.length !== 1 ||
      consent.userId !== row.userId ||
      consent.workosUserId !== row.workosUserId ||
      consent.clientId !== row.clientId ||
      consent.revokedAt === undefined ||
      consent.disconnectCompletedAt !== undefined ||
      consent.recoveryReceipt !== undefined
    ) {
      throw new Error("Disconnect recovery receipt binding mismatch");
    }
    const now = Date.now();
    const recoveryReceipt = receipt(args, now);
    await ctx.db.patch(consent._id, { recoveryReceipt });
    await ctx.db.patch(row._id, {
      state: "acknowledged",
      providerAcknowledgedAt: now,
      recoveryReceipt,
    });
    return null;
  },
});
export const recover = internalAction({
  args: recoveryArgs,
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    await ctx.runMutation(
      internal.workosDisconnectRecovery.acknowledgeConfirmed,
      args
    );
    const row: Doc<"workosApplicationDisconnects"> | null = await ctx.runQuery(
      internal.workosApplicationDisconnect.read,
      { fenceId: args.fenceId }
    );
    if (
      !row ||
      row.operationId !== args.operationId ||
      !["acknowledged", "completed"].includes(row.state)
    ) {
      return 503;
    }
    if (row.state === "completed") {
      return 204;
    }
    return completeAcknowledged(ctx, row);
  },
});
