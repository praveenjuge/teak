import type { FunctionReturnType } from "convex/server";
import type { Infer } from "convex/values";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  env,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { normalizeIdentityEmail } from "./userIdentityTable";
import { workosProfileValidator } from "./workosProfileFields";
import {
  compareWorkosProfileVersions,
  normalizeWorkosProfileVersion,
} from "./workosProfileVersion";

const capturedState = v.object({
  fingerprint: v.string(),
  externalId: v.union(v.string(), v.null()),
});
const sourceValidator = v.union(
  v.object({ kind: v.literal("event"), createdAt: v.string() }),
  v.object({
    kind: v.literal("reconciliation"),
    runId: v.id("workosReconciliationRuns"),
    generation: v.number(),
    expectedState: capturedState,
  })
);
const stateValidator = v.union(
  v.object({
    kind: v.literal("active"),
    profile: workosProfileValidator,
    providerUpdatedAt: v.optional(v.string()),
  }),
  v.object({ kind: v.literal("deleted") })
);
const argumentsValidator = {
  workosUserId: v.string(),
  state: stateValidator,
  source: sourceValidator,
};
type Source = Infer<typeof sourceValidator>;
type Profile = Infer<typeof workosProfileValidator>;
type Result =
  | { status: "applied" | "unchanged"; teakUserId: string }
  | { status: "stale" | "deleted" | "ignored_deleted" }
  | { status: "quarantined" | "rejected"; reason: string };
const validId = (value: string) => /^[A-Za-z0-9_-]{1,256}$/.test(value);

async function readState(
  ctx: QueryCtx,
  workosUserId: string,
  externalId?: string | null
) {
  const profiles = await ctx.db
    .query("workosProfiles")
    .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
    .take(2);
  const rows = await ctx.db
    .query("users")
    .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
    .take(3);
  const binding =
    externalId ??
    profiles[0]?.teakUserId ??
    rows[0]?.teakUserId ??
    profiles[0]?.profile?.externalId ??
    null;
  const owners =
    binding === null
      ? []
      : await ctx.db
          .query("users")
          .withIndex("by_teakUserId", (q) => q.eq("teakUserId", binding))
          .take(2);
  const deleting =
    binding === null
      ? []
      : await ctx.db
          .query("accountDeletionStates")
          .withIndex("by_userId", (q) => q.eq("userId", binding))
          .take(2);
  const tombstone = await ctx.db
    .query("workosEvents")
    .withIndex("by_workosUserId_and_type", (q) =>
      q.eq("workosUserId", workosUserId).eq("type", "user.deleted")
    )
    .first();
  let conflict: Doc<"migrationQuarantine"> | null = null;
  for (const reason of [
    "equal_timestamp_conflict",
    "duplicate_mapping",
    "external_id_mismatch",
    "link_conflict",
  ] as const) {
    conflict = await ctx.db
      .query("migrationQuarantine")
      .withIndex("by_workosUserId_and_reason_and_resolvedAt", (q) =>
        q
          .eq("workosUserId", workosUserId)
          .eq("reason", reason)
          .eq("resolvedAt", undefined)
      )
      .first();
    if (conflict) {
      break;
    }
  }
  const pendingQuery = () =>
    ctx.db
      .query("migrationQuarantine")
      .withIndex("by_workosUserId_and_reason_and_resolvedAt", (q) =>
        q
          .eq("workosUserId", workosUserId)
          .eq("reason", "profile_pending")
          .eq("resolvedAt", undefined)
      );
  const pending = await pendingQuery().take(101);
  // Capture the newest receipt too: new ambiguity must invalidate an in-flight GET
  // even when an older recovery batch has reached its bound.
  const latestPending = await pendingQuery().order("desc").first();
  return {
    profiles,
    rows,
    owners,
    deleting,
    tombstone,
    conflict,
    binding,
    pending,
    latestPending,
  };
}

async function capture(
  ctx: QueryCtx,
  workosUserId: string,
  externalId?: string | null
) {
  const state = await readState(ctx, workosUserId, externalId);
  return { fingerprint: JSON.stringify(state), externalId: state.binding };
}

// Capture before the remote GET; revalidate at commit, including legacy rows
// that have no revision yet. The fingerprint is internal, never a client token.
export const captureWorkosProfileState = internalQuery({
  args: {
    workosUserId: v.string(),
    externalId: v.optional(v.union(v.string(), v.null())),
  },
  returns: capturedState,
  handler: (ctx, args) => capture(ctx, args.workosUserId, args.externalId),
});

function validateProfile(profile: Profile): Profile {
  const email = normalizeIdentityEmail(profile.email);
  if (
    !/^[^\s@]+@[^\s@]+$/.test(email) ||
    email.length > 320 ||
    /\p{Cc}/u.test(email) ||
    (profile.externalId !== null && !validId(profile.externalId))
  ) {
    throw new Error("Invalid WorkOS profile");
  }
  for (const name of [profile.firstName, profile.lastName]) {
    if (name !== null && (name.length > 1024 || /\p{Cc}/u.test(name))) {
      throw new Error("Invalid WorkOS profile name");
    }
  }
  if (profile.profilePictureUrl !== null) {
    const url = new URL(profile.profilePictureUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      profile.profilePictureUrl.length > 4096
    ) {
      throw new Error("Invalid WorkOS profile image");
    }
  }
  return { ...profile, email };
}
const sameProfile = (left: Profile | undefined, right: Profile) =>
  left !== undefined &&
  Object.keys(right).every(
    (key) => left[key as keyof Profile] === right[key as keyof Profile]
  );

// This helper is the only profile write path. Adapters own authentication and
// original receipt dedupe; this transaction never fabricates provider events.
export async function applyWorkosProfileInTransaction(
  ctx: MutationCtx,
  args: {
    workosUserId: string;
    state: Infer<typeof stateValidator>;
    source: Source;
  }
): Promise<Result> {
  if (!validId(args.workosUserId)) {
    throw new Error("Invalid WorkOS user ID");
  }
  const { source } = args;
  let eventAt: number | undefined;
  if (source.kind === "event") {
    eventAt = Date.parse(normalizeWorkosProfileVersion(source.createdAt));
  } else {
    const run = await ctx.db.get("workosReconciliationRuns", source.runId);
    if (
      run?.mode !== "repair" ||
      run.generation !== source.generation ||
      run.leaseUntil <= Date.now() ||
      ["complete", "failed"].includes(run.phase)
    ) {
      return { status: "rejected", reason: "inactive_reconciliation" };
    }
    if (
      !(env.WORKOS_ENVIRONMENT_ID && process.env.WORKOS_CLIENT_ID) ||
      run.environmentId !== env.WORKOS_ENVIRONMENT_ID ||
      run.clientId !== process.env.WORKOS_CLIENT_ID
    ) {
      return { status: "rejected", reason: "environment_mismatch" };
    }
    const current = await capture(
      ctx,
      args.workosUserId,
      source.expectedState.externalId
    );
    if (current.fingerprint !== source.expectedState.fingerprint) {
      return { status: "rejected", reason: "state_changed" };
    }
  }
  const state = await readState(ctx, args.workosUserId);
  if (state.profiles.length > 1) {
    throw new Error("Duplicate canonical WorkOS profile");
  }
  const current = state.profiles[0];
  const envelopeAt = Math.max(
    eventAt ?? -1,
    current?.lastEventAt ?? -1,
    ...state.rows.map((row) => row.lastWorkosEventAt ?? -1)
  );
  const sourceFields = {
    source: source.kind,
    ...(source.kind === "reconciliation"
      ? { reconciliationRunId: source.runId }
      : {}),
    ...(envelopeAt >= 0 ? { lastEventAt: envelopeAt } : {}),
  };
  const store = async (fields: Partial<Doc<"workosProfiles">>) => {
    if (current) {
      await ctx.db.patch("workosProfiles", current._id, {
        ...fields,
        revision: current.revision + 1,
      });
    } else {
      await ctx.db.insert("workosProfiles", {
        workosUserId: args.workosUserId,
        revision: 1,
        ...sourceFields,
        ...fields,
      });
    }
  };
  const quarantine = async (
    reason: string,
    email = current?.profile?.email ?? ""
  ) => {
    const existing = await ctx.db
      .query("migrationQuarantine")
      .withIndex("by_workosUserId_and_reason_and_resolvedAt", (q) =>
        q
          .eq("workosUserId", args.workosUserId)
          .eq("reason", reason)
          .eq("resolvedAt", undefined)
      )
      .first();
    if (reason === "profile_pending") {
      // Every ambiguous observation invalidates a prior remote GET, even when
      // the quarantine receipt was deduplicated or its envelope time is equal.
      await store(sourceFields);
    }
    if (!existing) {
      await ctx.db.insert("migrationQuarantine", {
        workosUserId: args.workosUserId,
        ...(current?.teakUserId ? { teakUserId: current.teakUserId } : {}),
        email,
        reason,
        source: source.kind === "event" ? "webhook" : "reconcile",
        createdAt: Date.now(),
      });
    }
    for (const row of state.rows) {
      if (row.deletedAt === undefined && row.workosDeletedAt === undefined) {
        await ctx.db.patch("users", row._id, { workosEmailVerified: false });
      }
    }
    return { status: "quarantined" as const, reason };
  };
  const recoverPending = async () => {
    if (source.kind !== "reconciliation" || state.conflict) {
      return;
    }
    for (const receipt of state.pending.slice(0, 100)) {
      await ctx.db.patch("migrationQuarantine", receipt._id, {
        resolvedAt: Date.now(),
      });
    }
  };
  const pendingRemains =
    state.pending.length > 0 &&
    (source.kind !== "reconciliation" ||
      state.conflict !== null ||
      state.pending.length > 100);
  const deletionAt =
    current?.deletedAt ??
    state.tombstone?.createdAt ??
    state.rows.find((row) => row.workosDeletedAt !== undefined)
      ?.workosDeletedAt;
  if (deletionAt !== undefined || args.state.kind === "deleted") {
    if (current?.deletedAt === undefined) {
      let deletionSource: "event" | "reconciliation_not_found" | undefined;
      if (state.tombstone) {
        deletionSource = "event";
      } else if (args.state.kind === "deleted") {
        deletionSource =
          source.kind === "event" ? "event" : "reconciliation_not_found";
      }
      await store({
        ...sourceFields,
        deletedAt: deletionAt ?? eventAt ?? Date.now(),
        ...(deletionSource === undefined ? {} : { deletionSource }),
      });
    }
    // Mirror writes are bounded. The canonical terminal tombstone denies all
    // mappings, including malformed duplicates beyond this batch.
    for (const row of state.rows) {
      if (
        args.state.kind !== "deleted" &&
        row.workosDeletedAt !== undefined &&
        row.workosEmailVerified !== true
      ) {
        continue;
      }
      await ctx.db.patch("users", row._id, {
        workosDeletedAt:
          row.workosDeletedAt ?? deletionAt ?? eventAt ?? Date.now(),
        workosEmailVerified: false,
        ...(args.state.kind === "deleted" && envelopeAt >= 0
          ? {
              lastWorkosEventAt: Math.max(
                envelopeAt,
                row.lastWorkosEventAt ?? -1
              ),
            }
          : {}),
      });
    }
    return {
      status: args.state.kind === "deleted" ? "deleted" : "ignored_deleted",
    };
  }
  const profile = validateProfile(args.state.profile);
  if (args.state.providerUpdatedAt === undefined) {
    return quarantine("profile_pending", profile.email);
  }
  if (
    source.kind === "event" &&
    current?.providerUpdatedAt === undefined &&
    state.rows.some((row) => row.lastWorkosEventAt !== undefined)
  ) {
    return quarantine("profile_pending", profile.email);
  }
  const version = normalizeWorkosProfileVersion(args.state.providerUpdatedAt);
  const order =
    current?.providerUpdatedAt === undefined
      ? 1
      : compareWorkosProfileVersions(version, current.providerUpdatedAt);
  if (order < 0) {
    return { status: "stale" };
  }
  if (
    (current?.teakUserId &&
      profile.externalId !== current.profile?.externalId) ||
    (current?.profile?.externalId !== undefined &&
      profile.externalId !== current.profile.externalId)
  ) {
    return quarantine("external_id_mismatch", profile.email);
  }
  if (order === 0 && !sameProfile(current?.profile, profile)) {
    return quarantine("equal_timestamp_conflict", profile.email);
  }
  if (
    source.kind === "reconciliation" &&
    state.rows.length === 0 &&
    source.expectedState.externalId !== profile.externalId
  ) {
    return { status: "rejected", reason: "state_changed" };
  }
  if (state.rows.length > 1) {
    return quarantine("duplicate_mapping", profile.email);
  }
  if (
    current?.teakUserId &&
    (state.rows.length !== 1 || state.rows[0].teakUserId !== current.teakUserId)
  ) {
    return quarantine("link_conflict", profile.email);
  }
  if (state.conflict && state.conflict.reason !== "equal_timestamp_conflict") {
    return quarantine(state.conflict.reason, profile.email);
  }
  const linked: FunctionReturnType<typeof internal.workosUsers.linkWorkosUser> =
    await ctx.runMutation(internal.workosUsers.linkWorkosUser, {
      workosUserId: args.workosUserId,
      externalId: profile.externalId,
      email: profile.email,
      emailVerified: profile.emailVerified,
      source: "reconcile",
      allowCreate: false,
    });
  if (linked.status === "quarantined") {
    // Persist observed active state only if there is no established owner. A
    // rejected binding must never replace an already accepted provider profile.
    if (
      !(
        current?.teakUserId ||
        ["deleted_user", "deleting_user"].includes(linked.reason)
      ) &&
      state.rows.length === 0 &&
      order !== 0
    ) {
      await store({ ...sourceFields, profile, providerUpdatedAt: version });
    }
    if (
      !current?.teakUserId &&
      state.rows.length === 0 &&
      ["missing_mapping", "email_unverified"].includes(linked.reason)
    ) {
      await recoverPending();
    }
    if (["deleted_user", "deleting_user"].includes(linked.reason)) {
      return { status: "quarantined", reason: linked.reason };
    }
    return quarantine(linked.reason, profile.email);
  }
  if (current?.teakUserId && current.teakUserId !== linked.teakUserId) {
    return quarantine("link_conflict", profile.email);
  }
  const owner = await ctx.db
    .query("users")
    .withIndex("by_teakUserId", (q) => q.eq("teakUserId", linked.teakUserId))
    .unique();
  if (!owner) {
    throw new Error("Linked WorkOS owner unavailable");
  }
  await recoverPending();
  const denied = state.conflict !== null || pendingRemains;
  const verified = profile.emailVerified && !denied;
  const mirrorChanged =
    owner.workosEmail !== profile.email ||
    owner.workosEmailVerified !== verified ||
    (envelopeAt >= 0 && owner.lastWorkosEventAt !== envelopeAt);
  const profileChanged =
    order !== 0 || current?.teakUserId !== linked.teakUserId;
  if (profileChanged) {
    await store({
      ...sourceFields,
      teakUserId: linked.teakUserId,
      profile,
      providerUpdatedAt: version,
    });
  }
  if (mirrorChanged) {
    await ctx.db.patch("users", owner._id, {
      workosEmail: profile.email,
      workosEmailVerified: verified,
      ...(envelopeAt >= 0 ? { lastWorkosEventAt: envelopeAt } : {}),
    });
  }
  if (denied) {
    return {
      status: "quarantined",
      reason: state.conflict?.reason ?? "profile_pending",
    };
  }
  // A unique, accepted owner proves that this mapping-only observation has
  // recovered. Identity conflicts and ambiguous profiles return above and stay
  // quarantined. Bound each transaction; subsequent accepted observations drain
  // any remaining receipts without changing their historical contents.
  const missingMappings = await ctx.db
    .query("migrationQuarantine")
    .withIndex("by_workosUserId_and_reason_and_resolvedAt", (q) =>
      q
        .eq("workosUserId", args.workosUserId)
        .eq("reason", "missing_mapping")
        .eq("resolvedAt", undefined)
    )
    .take(100);
  for (const receipt of missingMappings) {
    await ctx.db.patch("migrationQuarantine", receipt._id, {
      resolvedAt: Date.now(),
    });
  }
  return {
    status:
      profileChanged || mirrorChanged || linked.changed
        ? "applied"
        : "unchanged",
    teakUserId: linked.teakUserId,
  };
}

export const applyWorkosProfile = internalMutation({
  args: argumentsValidator,
  returns: v.union(
    v.object({
      status: v.union(v.literal("applied"), v.literal("unchanged")),
      teakUserId: v.string(),
    }),
    v.object({
      status: v.union(
        v.literal("stale"),
        v.literal("deleted"),
        v.literal("ignored_deleted")
      ),
    }),
    v.object({
      status: v.union(v.literal("quarantined"), v.literal("rejected")),
      reason: v.string(),
    })
  ),
  handler: applyWorkosProfileInTransaction,
});
