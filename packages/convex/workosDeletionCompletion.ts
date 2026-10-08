import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { workosIssuer } from "./shared/workosApi";

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

export interface WorkosDeletionTarget {
  clientId: string;
  credentialFingerprint: string;
  environmentId: string;
  issuer: string;
}

export async function currentWorkosDeletionTarget(): Promise<
  WorkosDeletionTarget | undefined
> {
  const {
    WORKOS_ENVIRONMENT_ID: environmentId,
    WORKOS_CLIENT_ID: clientId,
    WORKOS_API_KEY: apiKey,
  } = process.env;
  if (!(environmentId && clientId && apiKey)) {
    return undefined;
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(apiKey)
  );
  return {
    environmentId,
    clientId,
    issuer: workosIssuer(clientId),
    credentialFingerprint: Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join(""),
  };
}

export function sameWorkosDeletionTarget(
  left: WorkosDeletionTarget,
  right: WorkosDeletionTarget
): boolean {
  return (
    left.environmentId === right.environmentId &&
    left.clientId === right.clientId &&
    left.issuer === right.issuer &&
    left.credentialFingerprint === right.credentialFingerprint
  );
}

// Completed cleanup alone is insufficient: the exact permanent owner and
// provider mapping must remain unique, and receipt time/target must correlate.
export async function expectedWorkosDeletionResolution(
  ctx: QueryCtx | MutationCtx,
  receipt: Pick<
    Doc<"migrationQuarantine">,
    | "reason"
    | "source"
    | "workosUserId"
    | "teakUserId"
    | "workosDeletionEventAt"
    | "workosDeletionTarget"
  >
): Promise<number | undefined> {
  if (
    receipt.reason !== "workos_user_deleted" ||
    receipt.source !== "webhook" ||
    !receipt.workosUserId ||
    !receipt.teakUserId ||
    receipt.workosDeletionEventAt === undefined ||
    !receipt.workosDeletionTarget
  ) {
    return undefined;
  }
  const { teakUserId, workosUserId } = receipt;
  const owners = await ctx.db
    .query("users")
    .withIndex("by_teakUserId", (q) => q.eq("teakUserId", teakUserId))
    .take(2);
  const providers = await ctx.db
    .query("users")
    .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
    .take(2);
  const owner = owners[0];
  const proof = owner?.workosDeletionCompletion;
  if (
    owners.length !== 1 ||
    providers.length !== 1 ||
    providers[0]._id !== owner?._id ||
    owner?.deletedAt === undefined ||
    !proof ||
    proof.version !== 1 ||
    proof.workosUserId !== receipt.workosUserId ||
    proof.generation < 1 ||
    !Number.isInteger(proof.generation) ||
    !Number.isFinite(proof.startedAt) ||
    !Number.isFinite(proof.completedAt) ||
    proof.completedAt < proof.startedAt ||
    !Number.isFinite(receipt.workosDeletionEventAt) ||
    receipt.workosDeletionEventAt < proof.startedAt ||
    receipt.workosDeletionEventAt > proof.completedAt ||
    !sameWorkosDeletionTarget(proof.target, receipt.workosDeletionTarget)
  ) {
    return undefined;
  }
  const current = await currentWorkosDeletionTarget();
  return current && sameWorkosDeletionTarget(proof.target, current)
    ? proof.completedAt
    : undefined;
}
