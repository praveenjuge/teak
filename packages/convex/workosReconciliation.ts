import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { applyWorkosProfileInTransaction } from "./workosProfileApply";
import {
  workosProfileValidator,
  workosReconciliationRunFields,
} from "./workosProfileFields";
import { normalizeWorkosProfileVersion } from "./workosProfileVersion";

const leaseMs = 300_000;
const identity = {
  environmentId: v.string(),
  clientId: v.string(),
  apiKeyFingerprint: v.string(),
};
const runValidator = v.object({
  ...workosReconciliationRunFields,
  _id: v.id("workosReconciliationRuns"),
  _creationTime: v.number(),
});
const phaseValidator = v.union(
  v.literal("events"),
  v.literal("provider"),
  v.literal("owners"),
  v.literal("complete")
);
const token = {
  runId: v.id("workosReconciliationRuns"),
  generation: v.number(),
};
const observation = v.object({
  workosUserId: v.string(),
  expectedState: v.object({
    fingerprint: v.string(),
    externalId: v.union(v.string(), v.null()),
  }),
  state: v.union(
    v.object({
      kind: v.literal("active"),
      profile: workosProfileValidator,
      providerUpdatedAt: v.string(),
    }),
    v.object({ kind: v.literal("deleted") })
  ),
});
const event = v.object({
  id: v.string(),
  createdAt: v.string(),
  event: v.union(
    v.literal("user.created"),
    v.literal("user.updated"),
    v.literal("user.deleted")
  ),
  data: v.record(v.string(), v.any()),
  context: v.optional(v.record(v.string(), v.any())),
});
async function leased(
  ctx: MutationCtx,
  args: { runId: Doc<"workosReconciliationRuns">["_id"]; generation: number }
) {
  const run = await ctx.db.get("workosReconciliationRuns", args.runId);
  if (
    !run ||
    run.generation !== args.generation ||
    run.leaseUntil <= Date.now() ||
    run.phase === "complete" ||
    run.phase === "failed"
  ) {
    throw new Error("Inactive reconciliation lease");
  }
  if (
    run.environmentId !== process.env.WORKOS_ENVIRONMENT_ID ||
    run.clientId !== process.env.WORKOS_CLIENT_ID
  ) {
    throw new Error("Reconciliation environment mismatch");
  }
  return run;
}
export const admit = internalMutation({
  args: {
    ...identity,
    runKey: v.string(),
    providerWitnessUserId: v.string(),
    mode: v.union(v.literal("audit"), v.literal("repair")),
    rangeStart: v.string(),
    rangeEnd: v.string(),
  },
  returns: v.id("workosReconciliationRuns"),
  handler: async (ctx, args) => {
    if (
      args.environmentId !== process.env.WORKOS_ENVIRONMENT_ID ||
      args.clientId !== process.env.WORKOS_CLIENT_ID
    ) {
      throw new Error("Reconciliation environment mismatch");
    }
    const start = Date.parse(args.rangeStart),
      end = Date.parse(args.rangeEnd);
    if (
      !(Number.isFinite(start) && Number.isFinite(end)) ||
      end < start ||
      end - start > 30 * 86_400_000 ||
      start < Date.now() - 90 * 86_400_000 ||
      end > Date.now()
    ) {
      throw new Error("Invalid reconciliation event range");
    }
    const prior = await ctx.db
      .query("workosReconciliationRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runKey))
      .unique();
    if (prior) {
      if (
        prior.environmentId !== args.environmentId ||
        prior.clientId !== args.clientId ||
        prior.apiKeyFingerprint !== args.apiKeyFingerprint ||
        prior.mode !== args.mode ||
        prior.providerWitnessUserId !== args.providerWitnessUserId ||
        prior.rangeStart !== args.rangeStart ||
        prior.rangeEnd !== args.rangeEnd
      ) {
        throw new Error("Reconciliation admission changed");
      }
      return prior._id;
    }
    const latest = await ctx.db
      .query("workosReconciliationRuns")
      .withIndex("by_environmentId_and_updatedAt", (q) =>
        q.eq("environmentId", args.environmentId)
      )
      .order("desc")
      .first();
    if (latest && latest.phase !== "complete" && latest.phase !== "failed") {
      throw new Error("Reconciliation already active");
    }
    return await ctx.db.insert("workosReconciliationRuns", {
      runId: args.runKey,
      environmentId: args.environmentId,
      clientId: args.clientId,
      apiKeyFingerprint: args.apiKeyFingerprint,
      providerWitnessUserId: args.providerWitnessUserId,
      mode: args.mode,
      rangeStart: args.rangeStart,
      rangeEnd: args.rangeEnd,
      generation: 0,
      leaseUntil: 0,
      phase: "events",
      scanned: 0,
      repaired: 0,
      quarantined: 0,
      deleted: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      retryCount: 0,
    });
  },
});
export const claim = internalMutation({
  args: { runId: token.runId, ...identity },
  returns: v.union(runValidator, v.null()),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("workosReconciliationRuns", args.runId);
    if (!run) {
      throw new Error("Unknown reconciliation run");
    }
    if (
      run.environmentId !== args.environmentId ||
      run.clientId !== args.clientId ||
      run.apiKeyFingerprint !== args.apiKeyFingerprint ||
      args.environmentId !== process.env.WORKOS_ENVIRONMENT_ID ||
      args.clientId !== process.env.WORKOS_CLIENT_ID
    ) {
      throw new Error("Reconciliation environment mismatch");
    }
    if (
      run.phase === "complete" ||
      run.phase === "failed" ||
      run.leaseUntil > Date.now() ||
      (run.nextAttemptAt ?? 0) > Date.now()
    ) {
      return null;
    }
    const generation = run.generation + 1;
    await ctx.db.patch("workosReconciliationRuns", run._id, {
      generation,
      leaseUntil: Date.now() + leaseMs,
      updatedAt: Date.now(),
    });
    // A hard action crash has no catch block: an expiry wakeup can reclaim it.
    await ctx.scheduler.runAfter(
      leaseMs + 1,
      internal.workosReconciliationActions.resume,
      { runId: run._id }
    );
    return { ...run, generation, leaseUntil: Date.now() + leaseMs };
  },
});
export const owners = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    page: v.array(v.string()),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("users")
      .paginate({ cursor: args.cursor, numItems: 20 });
    return {
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      page: page.page.flatMap((row) =>
        row.workosUserId ? [row.workosUserId] : []
      ),
    };
  },
});
export const checkpoint = internalMutation({
  args: {
    ...token,
    ...identity,
    phase: v.union(
      v.literal("events"),
      v.literal("provider"),
      v.literal("owners")
    ),
    cursor: v.optional(v.string()),
    nextCursor: v.optional(v.string()),
    done: v.boolean(),
    observations: v.array(observation),
    events: v.array(event),
  },
  returns: phaseValidator,
  handler: async (ctx, args) => {
    const run = await leased(ctx, args);
    const apiKey = process.env.WORKOS_API_KEY;
    if (!apiKey) {
      throw new Error("Reconciliation credential mismatch");
    }
    // Actions retain their invocation environment. Verify the current mutation
    // environment independently before committing a remotely observed page.
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(apiKey)
    );
    const currentFingerprint = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (
      run.apiKeyFingerprint !== currentFingerprint ||
      run.environmentId !== args.environmentId ||
      run.clientId !== args.clientId ||
      run.apiKeyFingerprint !== args.apiKeyFingerprint
    ) {
      throw new Error("Reconciliation credential mismatch");
    }
    if (
      run.phase !== args.phase ||
      args.observations.length > 20 ||
      args.events.length > 100
    ) {
      throw new Error("Invalid reconciliation page");
    }
    const cursorField = {
      events: "eventCursor",
      provider: "providerCursor",
      owners: "ownerCursor",
    }[args.phase] as "eventCursor" | "providerCursor" | "ownerCursor";
    if (
      run[cursorField] !== args.cursor ||
      (!args.done && (!args.nextCursor || args.nextCursor === args.cursor))
    ) {
      throw new Error("Non-progressing reconciliation cursor");
    }
    const nextCursor = args.nextCursor;
    if (nextCursor) {
      const seen = await ctx.db
        .query("workosReconciliationCursors")
        .withIndex("by_runId_and_phase_and_cursor", (q) =>
          q
            .eq("runId", run._id)
            .eq("phase", args.phase)
            .eq("cursor", nextCursor)
        )
        .first();
      if (seen) {
        throw new Error("Non-progressing reconciliation cursor");
      }
      await ctx.db.insert("workosReconciliationCursors", {
        runId: run._id,
        phase: args.phase,
        cursor: nextCursor,
      });
    }
    let repaired = 0,
      quarantined = 0,
      deleted = 0,
      drifted = 0;
    const auditEvidence = [...(run.auditEvidence ?? [])];
    if (run.mode === "audit") {
      for (const observed of args.observations) {
        const captured = await ctx.runQuery(
          internal.workosProfileApply.captureWorkosProfileState,
          {
            workosUserId: observed.workosUserId,
            externalId: observed.expectedState.externalId,
          }
        );
        if (captured.fingerprint !== observed.expectedState.fingerprint) {
          throw new Error("Reconciliation state_changed");
        }
        const profiles = await ctx.db
          .query("workosProfiles")
          .withIndex("by_workosUserId", (q) =>
            q.eq("workosUserId", observed.workosUserId)
          )
          .take(2);
        const rows = await ctx.db
          .query("users")
          .withIndex("by_workosUserId", (q) =>
            q.eq("workosUserId", observed.workosUserId)
          )
          .take(2);
        const reasons: string[] = [];
        const current = profiles[0];
        if (profiles.length > 1) {
          reasons.push("duplicate_profile");
        }
        if (rows.length > 1) {
          reasons.push("duplicate_mapping");
        }
        if (observed.state.kind === "deleted") {
          if (
            current?.deletedAt === undefined ||
            rows.some(
              (row) =>
                row.workosDeletedAt === undefined || row.workosEmailVerified
            )
          ) {
            reasons.push("provider_absent_without_terminal_denial");
          }
        } else {
          const remote = observed.state.profile;
          if (current) {
            if (
              current.deletedAt !== undefined ||
              rows.some(
                (row) =>
                  row.workosDeletedAt !== undefined ||
                  row.deletedAt !== undefined
              )
            ) {
              reasons.push("local_terminal_provider_active");
            }
            if (
              !current.profile ||
              Object.keys(remote).some(
                (key) =>
                  current.profile?.[key as keyof typeof remote] !==
                  remote[key as keyof typeof remote]
              )
            ) {
              reasons.push("profile_difference");
            }
            if (
              current.providerUpdatedAt !==
              normalizeWorkosProfileVersion(observed.state.providerUpdatedAt)
            ) {
              reasons.push("provider_version_difference");
            }
          } else {
            reasons.push("canonical_profile_missing");
          }
          const tombstone = await ctx.db
            .query("workosEvents")
            .withIndex("by_workosUserId_and_type", (q) =>
              q
                .eq("workosUserId", observed.workosUserId)
                .eq("type", "user.deleted")
            )
            .first();
          if (
            tombstone &&
            !reasons.includes("local_terminal_provider_active")
          ) {
            reasons.push("local_terminal_provider_active");
          }
          if (rows.length === 0) {
            reasons.push("mapping_missing");
          }
          if (
            remote.externalId !== null &&
            rows.some((row) => row.teakUserId !== remote.externalId)
          ) {
            reasons.push("external_id_mismatch");
          }
          if (
            current?.teakUserId &&
            rows.some((row) => row.teakUserId !== current.teakUserId)
          ) {
            reasons.push("canonical_owner_mismatch");
          }
          if (
            rows.some(
              (row) =>
                row.workosEmail !== remote.email ||
                row.workosEmailVerified !== remote.emailVerified
            )
          ) {
            reasons.push("mirror_difference");
          }
        }
        // Query each recognized reason at the unresolved index suffix. Historical
        // resolved rows must never hide a current denial behind a bounded prefix.
        for (const reason of [
          "equal_timestamp_conflict",
          "duplicate_mapping",
          "external_id_mismatch",
          "link_conflict",
          "deleted_user",
          "workos_deleted_user",
          "workos_user_deleted",
          "deleting_user",
          "email_unverified",
          "ambiguous_email",
          "profile_pending",
          "missing_mapping",
          "signups_frozen",
        ]) {
          const quarantine = await ctx.db
            .query("migrationQuarantine")
            .withIndex("by_workosUserId_and_reason_and_resolvedAt", (q) =>
              q
                .eq("workosUserId", observed.workosUserId)
                .eq("reason", reason)
                .eq("resolvedAt", undefined)
            )
            .first();
          if (quarantine) {
            reasons.push("unresolved_quarantine");
            break;
          }
        }
        if (reasons.length) {
          drifted += 1;
          if (auditEvidence.length < 20) {
            auditEvidence.push({
              workosUserId: observed.workosUserId,
              reasons,
            });
          }
        }
      }
    }
    if (run.mode === "repair") {
      for (const envelope of args.events) {
        await ctx.runMutation(internal.workosWebhook.syncVerifiedEvent, {
          ...envelope,
          replay: true,
        });
      }
      for (const observed of args.observations) {
        const result = await applyWorkosProfileInTransaction(ctx, {
          ...observed,
          source: {
            kind: "reconciliation",
            runId: run._id,
            generation: args.generation,
            expectedState: observed.expectedState,
          },
        });
        if (result.status === "rejected") {
          throw new Error(`Reconciliation ${result.reason}`);
        }
        repaired += Number(result.status === "applied");
        quarantined += Number(result.status === "quarantined");
        deleted += Number(result.status === "deleted");
      }
    }
    const nextPhase = {
      events: "provider",
      provider: "owners",
      owners: "complete",
    } as const;
    const phase = args.done ? nextPhase[args.phase] : args.phase;
    await ctx.db.patch("workosReconciliationRuns", run._id, {
      phase,
      [cursorField]: args.nextCursor,
      scanned: run.scanned + args.events.length + args.observations.length,
      drifted: (run.drifted ?? 0) + drifted,
      auditEvidence,
      repaired: run.repaired + repaired,
      quarantined: run.quarantined + quarantined,
      deleted: run.deleted + deleted,
      retryCount: 0,
      nextAttemptAt: undefined,
      leaseUntil: 0,
      updatedAt: Date.now(),
    });
    if (phase !== "complete") {
      await ctx.scheduler.runAfter(
        0,
        internal.workosReconciliationActions.resume,
        { runId: run._id }
      );
    }
    if (phase === "complete") {
      await ctx.scheduler.runAfter(
        0,
        internal.workosReconciliation.cleanupCursors,
        { runId: run._id }
      );
    }
    return phase;
  },
});
export const interruption = internalMutation({
  args: { ...token, retryDelayMs: v.optional(v.number()), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await leased(ctx, args);
    const retry = args.retryDelayMs !== undefined;
    const delay = Math.min(3_600_000, Math.max(1000, args.retryDelayMs ?? 0));
    await ctx.db.patch("workosReconciliationRuns", run._id, {
      phase: retry ? run.phase : "failed",
      leaseUntil: 0,
      nextAttemptAt: retry ? Date.now() + delay : undefined,
      retryCount: run.retryCount + 1,
      failureReason: args.reason.slice(0, 128),
      updatedAt: Date.now(),
    });
    if (retry) {
      await ctx.scheduler.runAfter(
        delay,
        internal.workosReconciliationActions.resume,
        { runId: run._id }
      );
    } else {
      await ctx.scheduler.runAfter(
        0,
        internal.workosReconciliation.cleanupCursors,
        { runId: run._id }
      );
    }
    return null;
  },
});
export const report = internalQuery({
  args: { runId: token.runId },
  returns: v.union(runValidator, v.null()),
  handler: (ctx, args) => ctx.db.get("workosReconciliationRuns", args.runId),
});

export const cleanupCursors = internalMutation({
  args: { runId: token.runId },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("workosReconciliationRuns", args.runId);
    if (!run || (run.phase !== "complete" && run.phase !== "failed")) {
      return null;
    }
    const rows = await ctx.db
      .query("workosReconciliationCursors")
      .withIndex("by_runId_and_phase_and_cursor", (q) => q.eq("runId", run._id))
      .take(100);
    for (const row of rows) {
      await ctx.db.delete("workosReconciliationCursors", row._id);
    }
    if (rows.length === 100) {
      await ctx.scheduler.runAfter(
        0,
        internal.workosReconciliation.cleanupCursors,
        args
      );
    }
    return null;
  },
});
