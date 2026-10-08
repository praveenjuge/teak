import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import type { BetterAuthUserSource } from "./userIdentityTable";

const pageSize = 20;
const normalize = (email: string) => email.trim().toLowerCase();
type Counts = Record<string, number>;
const increment = (counts: Counts, key: string, amount = 1) => {
  counts[key] = (counts[key] ?? 0) + amount;
};
async function users(
  ctx: MutationCtx,
  run: Doc<"workosReconciliationRuns">,
  counts: Counts
) {
  const page = await ctx.db
    .query("users")
    .paginate({ cursor: run.censusCursor ?? null, numItems: pageSize });
  for (const row of page.page) {
    increment(counts, "ownerRowsScanned");
    if (row.deletedAt !== undefined) {
      increment(counts, "ownerTombstones");
      continue;
    }
    if (!row.workosUserId) {
      increment(counts, "missingWorkosMapping");
    }
    const email = normalize(row.email);
    if (!email || row.email !== email) {
      increment(counts, "invalidNormalizedEmail");
    }
    const sameEmail = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(2);
    // Every duplicate row is counted; this is a row count, not a unique group count.
    if (sameEmail.length > 1) {
      increment(counts, "duplicateEmailRows");
    }
    const sameOwner = await ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", row.teakUserId))
      .take(2);
    if (sameOwner.length > 1) {
      increment(counts, "duplicateOwnerRows");
    }
    if (row.workosUserId) {
      const mappings = await ctx.db
        .query("users")
        .withIndex("by_workosUserId", (q) =>
          q.eq("workosUserId", row.workosUserId)
        )
        .take(2);
      if (mappings.length > 1) {
        increment(counts, "duplicateWorkosMappingRows");
      }
    }
    // Owners WorkOS created have a `teak_` key that is no Better Auth document
    // ID, so looking one up would throw.
    const source =
      row.identityOrigin === "workos"
        ? null
        : ((await ctx.runQuery(components.betterAuth.adapter.findOne, {
            model: "user",
            where: [{ field: "_id", value: row.teakUserId }],
          })) as BetterAuthUserSource | null);
    if (!source) {
      const provenWorkosOwner =
        row.identityOrigin === "workos" && Boolean(row.workosUserId);
      increment(
        counts,
        provenWorkosOwner ? "workosOriginOwners" : "missingBetterAuthOwner"
      );
    } else if (
      normalize(source.email) !== email ||
      source.emailVerified !== row.emailVerified
    ) {
      increment(counts, "betterAuthMirrorDrift");
    }
  }
  return page;
}
async function betterauth(
  ctx: MutationCtx,
  run: Doc<"workosReconciliationRuns">,
  counts: Counts
) {
  const page = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "user",
    paginationOpts: { cursor: run.censusCursor ?? null, numItems: pageSize },
  });
  for (const source of page.page as BetterAuthUserSource[]) {
    increment(counts, "betterAuthUsersScanned");
    const rows = await ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", source._id))
      .take(2);
    if (rows.length === 0) {
      increment(counts, "missingAppOwner");
    } else if (
      rows.length !== 1 ||
      rows[0].deletedAt !== undefined ||
      rows[0].email !== normalize(source.email) ||
      rows[0].emailVerified !== source.emailVerified
    ) {
      increment(counts, "betterAuthSourceDrift");
    }
  }
  return page;
}
async function quarantine(
  ctx: MutationCtx,
  run: Doc<"workosReconciliationRuns">,
  counts: Counts
) {
  const page = await ctx.db
    .query("migrationQuarantine")
    .withIndex("by_unresolved", (q) => q.eq("resolvedAt", undefined))
    .paginate({ cursor: run.censusCursor ?? null, numItems: pageSize });
  increment(counts, "unresolvedQuarantine", page.page.length);
  return page;
}
export const checkpoint = internalMutation({
  args: { runId: v.id("workosReconciliationRuns"), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("workosReconciliationRuns", args.runId);
    if (
      run?.phase !== "census" ||
      run.generation !== args.generation ||
      run.leaseUntil <= Date.now()
    ) {
      throw new Error("Inactive reconciliation lease");
    }
    const apiKey = process.env.WORKOS_API_KEY;
    if (
      !apiKey ||
      run.environmentId !== process.env.WORKOS_ENVIRONMENT_ID ||
      run.clientId !== process.env.WORKOS_CLIENT_ID
    ) {
      throw new Error("Reconciliation environment mismatch");
    }
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(apiKey)
    );
    const fingerprint = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (fingerprint !== run.apiKeyFingerprint) {
      throw new Error("Reconciliation credential mismatch");
    }
    const counts = { ...(run.censusCounts ?? {}) };
    const section = run.censusSection ?? "users";
    const page =
      section === "users"
        ? await users(ctx, run, counts)
        : section === "betterauth"
          ? await betterauth(ctx, run, counts)
          : await quarantine(ctx, run, counts);
    if (
      !page.isDone &&
      (!page.continueCursor || page.continueCursor === run.censusCursor)
    ) {
      throw new Error("Non-progressing reconciliation cursor");
    }
    if (!page.isDone) {
      const cursor = `${section}:${page.continueCursor}`;
      const seen = await ctx.db
        .query("workosReconciliationCursors")
        .withIndex("by_runId_and_phase_and_cursor", (q) =>
          q.eq("runId", run._id).eq("phase", "census").eq("cursor", cursor)
        )
        .first();
      if (seen) {
        throw new Error("Non-progressing reconciliation cursor");
      }
      await ctx.db.insert("workosReconciliationCursors", {
        runId: run._id,
        phase: "census",
        cursor,
      });
    }
    const complete = page.isDone && section === "quarantine";
    const nextSection = page.isDone
      ? (
          {
            users: "betterauth",
            betterauth: "quarantine",
            quarantine: "quarantine",
          } as const
        )[section]
      : section;
    await ctx.db.patch("workosReconciliationRuns", run._id, {
      censusCounts: counts,
      censusCursor: page.isDone ? undefined : page.continueCursor,
      censusSection: nextSection,
      censusComplete: complete,
      phase: complete ? "complete" : "census",
      leaseUntil: 0,
      retryCount: 0,
      nextAttemptAt: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      complete
        ? internal.workosReconciliation.cleanupCursors
        : internal.workosReconciliationActions.resume,
      { runId: run._id }
    );
    return null;
  },
});
const scanCounts = new Set([
  "ownerRowsScanned",
  "ownerTombstones",
  "workosOriginOwners",
  "betterAuthUsersScanned",
]);
export const readiness = internalQuery({
  args: { runId: v.id("workosReconciliationRuns") },
  returns: v.object({
    complete: v.boolean(),
    zero: v.boolean(),
    reason: v.string(),
    counts: v.record(v.string(), v.number()),
  }),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("workosReconciliationRuns", args.runId);
    const counts = run?.censusCounts ?? {};
    const complete =
      run?.mode === "audit" &&
      run.phase === "complete" &&
      run.censusVersion === 1 &&
      run.censusComplete === true;
    const zero =
      complete &&
      (run.drifted ?? 0) === 0 &&
      Object.entries(counts).every(
        ([key, count]) => scanCounts.has(key) || count === 0
      );
    let reason = "full_audit_incomplete";
    if (complete) {
      reason = zero
        ? "observed_zero_requires_runtime_and_time_gates"
        : "drift_or_quarantine";
    }
    return {
      complete,
      zero,
      reason,
      counts,
    };
  },
});
