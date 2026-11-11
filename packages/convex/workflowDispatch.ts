import {
  type DispatchItem,
  MAX_DISPATCH_ITEMS,
  normalizeConvexSiteUrl,
  signDispatchProof,
  WORKFLOW_INSTANCE_MISSING,
} from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { accountDeletionDispatch } from "./accountDeletion/workflowRun";
import { cardProcessingDispatch } from "./card/processingRuns";
import { exportDispatch } from "./export/workflowRun";
import { importDispatch } from "./import/workflowRun";
import {
  callCoreWorkerOp,
  isCoreWorkerConfigured,
} from "./storage/coreWorkerClient";
import { objectDeletionDispatch } from "./storage/objectDeletion";
import { reportFromMutation } from "./telemetry/alerts";
import { captureBackendException } from "./telemetry/posthog";
import {
  analyticsEventDispatch,
  asDispatchRow,
  type DispatchKind,
  type DispatchKindSpec,
  type DispatchKindSpecs,
  maintenanceDispatch,
  scheduleFlush,
} from "./workflowDispatch/outbox";

/**
 * How each kind of row is sent and settled, declared beside its domain.
 * The type requires one entry per kind in `DISPATCH_PARAMS`, the list the
 * table's `kind` and `params` validators come from.
 */
const KINDS: DispatchKindSpecs = {
  accountDeletion: accountDeletionDispatch,
  analyticsEvent: analyticsEventDispatch,
  cardProcessing: cardProcessingDispatch,
  deleteObjects: objectDeletionDispatch,
  export: exportDispatch,
  import: importDispatch,
  maintenance: maintenanceDispatch,
};

/**
 * The spec of a row's kind. `KINDS` pairs every kind with a spec of the
 * same kind, so the row always fits the handlers it is given to.
 */
const specFor = (row: { kind: DispatchKind }) =>
  KINDS[row.kind] as unknown as DispatchKindSpec<DispatchKind>;

export const DISPATCH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_DISPATCH_ATTEMPTS = 20;
const FLUSH_BATCH = MAX_DISPATCH_ITEMS;

// Parallel flushes conflict with each other in claim (see FLUSH_JITTER_MS
// in workflowDispatch/outbox). Claim reads only a small page per mutation
// so conflicting transactions stay short, and a flush whose claim still
// exhausts Convex's retries reschedules itself with backoff instead of
// dying. Rows that somehow stay pending past PENDING_STALL_MS are re-armed
// by the hourly workflowDispatchWatchdog cron, so a failed flush never
// strands work silently.
export const CLAIM_PAGE = 16;
const MAX_CLAIM_RETRY_ATTEMPTS = 8;

export const claimRetryDelayMs = (attempt: number): number | null =>
  attempt >= MAX_CLAIM_RETRY_ATTEMPTS
    ? null
    : Math.min(60_000, 1000 * 2 ** Math.max(0, attempt));

interface ClaimedItem {
  id: Id<"workflowDispatches">;
  item: DispatchItem;
}

/**
 * Settles a due row and returns what the Worker receives for it, or null
 * when the row no longer needs sending.
 */
const claimRow = async (
  ctx: MutationCtx,
  row: Doc<"workflowDispatches">,
  now: number
): Promise<DispatchItem | null> => {
  const run = asDispatchRow(row);
  const spec = specFor(row);
  if (spec.delivery === "analytics-event") {
    // Best effort, like an event an action sends itself: the row goes when
    // it is handed over, so delivery needs no second write.
    await ctx.db.delete("workflowDispatches", row._id);
    return run?.kind === "analyticsEvent"
      ? { ...run.params, type: "analytics-event" }
      : null;
  }
  if (spec.delivery === "delete-objects") {
    await ctx.db.patch("workflowDispatches", row._id, {
      attempts: (row.attempts ?? 0) + 1,
      sentAt: now,
      state: "sent",
    });
    return { keys: row.keys ?? [], type: "delete-objects" };
  }
  const prepared =
    run && spec.prepare ? await spec.prepare(ctx, run) : { terminate: [] };
  if ("skip" in prepared) {
    await ctx.db.patch("workflowDispatches", row._id, {
      error: prepared.skip,
      finishedAt: now,
      state: "done",
    });
    return null;
  }
  await ctx.db.patch("workflowDispatches", row._id, {
    attempts: (row.attempts ?? 0) + 1,
    lastReconciledAt: undefined,
    ...(row.reset ? { reset: undefined } : {}),
    sentAt: now,
    state: "sent",
  });
  return {
    id: row.instanceId as string,
    params: row.params ?? {},
    ...(prepared.terminate.length > 0 ? { terminate: prepared.terminate } : {}),
    type: "workflow",
    workflow: spec.workflow,
  };
};

export const claim = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.object({ id: v.id("workflowDispatches"), item: v.any() })),
  handler: async (ctx, { limit }): Promise<ClaimedItem[]> => {
    const now = Date.now();
    const pageSize = Math.min(limit ?? FLUSH_BATCH, FLUSH_BATCH);
    const rows = await ctx.db
      .query("workflowDispatches")
      .withIndex("by_state_and_notBefore", (q) =>
        q.eq("state", "pending").lte("notBefore", now)
      )
      .take(pageSize);
    const claimed: ClaimedItem[] = [];
    for (const row of rows) {
      const item = await claimRow(ctx, row, now);
      if (item) {
        claimed.push({ id: row._id, item });
      }
    }
    // A full page of superseded runs hands nothing over, which ends the
    // flush, so the rows behind it need one of their own.
    if (claimed.length === 0 && rows.length === pageSize) {
      await ctx.scheduler.runAfter(0, internal.workflowDispatch.flush, {});
    }
    return claimed;
  },
});

const retryDelayMs = (attempts: number) =>
  Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempts - 1));

export const release = internalMutation({
  args: {
    error: v.string(),
    ids: v.array(v.id("workflowDispatches")),
  },
  returns: v.null(),
  handler: async (ctx, { error, ids }) => {
    const now = Date.now();
    let earliest: number | null = null;
    for (const id of ids) {
      const row = await ctx.db.get("workflowDispatches", id);
      if (row?.state !== "sent") {
        continue;
      }
      const attempts = row.attempts ?? 1;
      if (attempts >= MAX_DISPATCH_ATTEMPTS) {
        await ctx.db.patch("workflowDispatches", id, {
          error: `dispatch_failed:${error}`.slice(0, 300),
          finishedAt: now,
          state: "failed",
        });
        await reportFromMutation(ctx, "workflow_dispatch_dead_lettered", {
          attempts,
          error: error.slice(0, 200),
          kind: row.kind,
        });
        await handleRunFailure(ctx, row, "dispatch_failed");
        continue;
      }
      const notBefore = now + retryDelayMs(attempts);
      await ctx.db.patch("workflowDispatches", id, {
        error: error.slice(0, 300),
        notBefore,
        state: "pending",
      });
      earliest = earliest === null ? notBefore : Math.min(earliest, notBefore);
    }
    if (earliest !== null) {
      await scheduleFlush(ctx, earliest - now);
    }
    return null;
  },
});

export const flush = internalAction({
  args: { claimRetry: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { claimRetry = 0 }) => {
    // Convex sets CONVEX_SITE_URL for every deployment; workflows call it back.
    const convexSiteUrl = normalizeConvexSiteUrl(env.CONVEX_SITE_URL);
    const secret = env.WORKFLOW_RPC_SECRET;
    if (!(isCoreWorkerConfigured() && convexSiteUrl && secret)) {
      const waiting: boolean = await ctx.runQuery(
        internal.workflowDispatch.hasPending,
        {}
      );
      if (waiting) {
        await captureBackendException(
          new Error("workflow_dispatch_not_configured"),
          {
            properties: {
              convex_site_url: Boolean(convexSiteUrl),
              files_worker: isCoreWorkerConfigured(),
              rpc_secret: Boolean(secret),
            },
          }
        );
      }
      return null;
    }
    for (let round = 0; round < 10; round += 1) {
      let claimed: ClaimedItem[];
      try {
        // A small page keeps each claim mutation short: parallel flushes
        // conflict on the same due rows, and short conflicting transactions
        // are what Convex's internal retries recover from reliably.
        claimed = await ctx.runMutation(internal.workflowDispatch.claim, {
          limit: CLAIM_PAGE,
        });
      } catch (caught) {
        // Parallel flushes conflict with each other in claim. Convex retries
        // the mutation, but a claim that still exhausts those retries must
        // not kill the flush: the rows stay pending and would wait for the
        // next save. Back off and re-run instead; after a run of failures,
        // report and stop - the hourly watchdog re-arms a flush once rows
        // pass PENDING_STALL_MS, so stopping here strands nothing.
        const delay = claimRetryDelayMs(claimRetry);
        if (delay === null) {
          await captureBackendException(
            caught instanceof Error ? caught : new Error(String(caught)),
            {
              properties: {
                source: "workflow_dispatch_claim_retry_exhausted",
              },
            }
          );
          return null;
        }
        await ctx.scheduler.runAfter(delay, internal.workflowDispatch.flush, {
          claimRetry: claimRetry + 1,
        });
        return null;
      }
      if (claimed.length === 0) {
        return null;
      }
      // Claiming removed the analytics rows, so only the rest can be retried.
      const retryable = (accepted?: Set<number>) =>
        claimed
          .filter(
            ({ item }, index) =>
              item.type !== "analytics-event" && !accepted?.has(index)
          )
          .map(({ id }) => id);
      let failedIds: Id<"workflowDispatches">[] = [];
      let deliveredIds: Id<"workflowDispatches">[] = [];
      let error = "dispatch_rejected";
      try {
        const items = claimed.map(({ item }) => item);
        const outcome = await callCoreWorkerOp({
          op: "dispatch",
          params: {
            convexSiteUrl,
            items,
            ...(await signDispatchProof({ convexSiteUrl, items, secret })),
          },
        });
        if (outcome.kind === "declined") {
          failedIds = retryable();
          error = outcome.code;
        } else {
          const accepted = new Set(
            outcome.data.results
              .filter((result) => result.ok)
              .map((result) => result.index)
          );
          failedIds = retryable(accepted);
          deliveredIds = claimed
            .filter(
              ({ item }, index) =>
                accepted.has(index) && item.type === "delete-objects"
            )
            .map(({ id }) => id);
          error =
            outcome.data.results.find((result) => !result.ok)?.error ??
            "dispatch_rejected";
        }
      } catch (caught) {
        failedIds = retryable();
        error = caught instanceof Error ? caught.message : String(caught);
      }
      if (deliveredIds.length > 0) {
        await ctx.runMutation(internal.workflowDispatch.markDelivered, {
          ids: deliveredIds,
        });
      }
      if (failedIds.length > 0) {
        await ctx.runMutation(internal.workflowDispatch.release, {
          error,
          ids: failedIds,
        });
      }
    }
    await ctx.scheduler.runAfter(0, internal.workflowDispatch.flush, {});
    return null;
  },
});

export const hasPending = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) =>
    (await ctx.db
      .query("workflowDispatches")
      .withIndex("by_state_and_notBefore", (q) => q.eq("state", "pending"))
      .first()) !== null,
});

/**
 * A run that died, or a dispatch that gave up, is handed to its kind's own
 * handler, kept beside that kind's domain code.
 */
const handleRunFailure = async (
  ctx: MutationCtx,
  row: Doc<"workflowDispatches">,
  error: string
): Promise<void> => {
  const run = asDispatchRow(row);
  if (run) {
    await specFor(run).onFailure?.(ctx, run, error);
  }
};

export const complete = internalMutation({
  args: {
    error: v.optional(v.string()),
    instanceId: v.string(),
    status: v.union(v.literal("complete"), v.literal("errored")),
  },
  returns: v.null(),
  handler: async (ctx, { error, instanceId, status }) => {
    const rows = await ctx.db
      .query("workflowDispatches")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", instanceId))
      .take(10);
    const row = rows.find(
      (candidate) => candidate.state === "pending" || candidate.state === "sent"
    );
    if (!row) {
      return null;
    }
    const now = Date.now();
    if (
      error === WORKFLOW_INSTANCE_MISSING &&
      row.state === "sent" &&
      (row.attempts ?? 1) < MAX_DISPATCH_ATTEMPTS
    ) {
      await ctx.db.patch("workflowDispatches", row._id, {
        error: WORKFLOW_INSTANCE_MISSING,
        notBefore: now,
        state: "pending",
      });
      await scheduleFlush(ctx);
      return null;
    }
    await ctx.db.patch("workflowDispatches", row._id, {
      finishedAt: now,
      state: status === "complete" ? "done" : "failed",
      ...(error ? { error: error.slice(0, 300) } : {}),
    });
    if (status === "errored") {
      await handleRunFailure(ctx, row, "workflow_failed");
    }
    const run = asDispatchRow(row);
    const spec = specFor(row);
    if (run && spec.delivery === "workflow") {
      await spec.onRunEnded?.(ctx, run, status);
    }
    return null;
  },
});

export const markDelivered = internalMutation({
  args: { ids: v.array(v.id("workflowDispatches")) },
  returns: v.null(),
  handler: async (ctx, { ids }) => {
    const now = Date.now();
    for (const id of ids) {
      const row = await ctx.db.get("workflowDispatches", id);
      if (row?.state === "sent" && specFor(row).delivery === "delete-objects") {
        await ctx.db.patch("workflowDispatches", id, {
          finishedAt: now,
          state: "done",
        });
      }
    }
    return null;
  },
});

const STALE_SCAN_BUDGET = 1000;

/** The Worker workflow a row starts, if its kind starts one. */
const workflowOf = (row: Doc<"workflowDispatches">) => {
  const spec = specFor(row);
  return spec.delivery === "workflow" && row.instanceId !== undefined
    ? { instanceId: row.instanceId, workflow: spec.workflow }
    : null;
};

const isStale = (row: Doc<"workflowDispatches">, now: number) => {
  const spec = specFor(row);
  return (
    spec.delivery === "workflow" &&
    row.instanceId !== undefined &&
    (row.sentAt ?? now) < now - spec.staleAfterMs
  );
};

/** The shortest silence after which any kind's sent run counts as stale. */
const SHORTEST_STALE_MS = Math.min(
  ...Object.values(KINDS).flatMap((spec) =>
    spec.delivery === "workflow" ? [spec.staleAfterMs] : []
  )
);

/**
 * Sent runs past their kind's silence limit, for the Core Worker's reconcile
 * to look up: first the ones it never checked, oldest send first, then the
 * ones it checked longest ago (`markReconciled`). Runs still going in
 * Cloudflare so move to the back instead of hiding newer stale ones.
 */
export const listStale = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      instanceId: v.string(),
      kind: v.string(),
      workflow: v.string(),
    })
  ),
  handler: async (ctx, { limit }) => {
    const now = Date.now();
    const pageSize = Math.min(limit ?? 100, 200);
    const stale: Doc<"workflowDispatches">[] = [];
    let scanned = 0;
    const collect = async (
      rows: AsyncIterable<Doc<"workflowDispatches">>
    ): Promise<void> => {
      for await (const row of rows) {
        if (stale.length >= pageSize || scanned >= STALE_SCAN_BUDGET) {
          return;
        }
        scanned += 1;
        if (isStale(row, now)) {
          stale.push(row);
        }
      }
    };
    await collect(
      ctx.db
        .query("workflowDispatches")
        .withIndex("by_state_and_lastReconciledAt_and_sentAt", (q) =>
          q
            .eq("state", "sent")
            .eq("lastReconciledAt", undefined)
            .lt("sentAt", now - SHORTEST_STALE_MS)
        )
    );
    await collect(
      ctx.db
        .query("workflowDispatches")
        .withIndex("by_state_and_lastReconciledAt_and_sentAt", (q) =>
          q.eq("state", "sent").gte("lastReconciledAt", 0)
        )
    );
    return stale.flatMap((row) => {
      const started = workflowOf(row);
      return started ? [{ ...started, kind: row.kind }] : [];
    });
  },
});

export const markReconciled = internalMutation({
  args: { instanceIds: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { instanceIds }) => {
    const now = Date.now();
    for (const instanceId of instanceIds.slice(0, 200)) {
      const rows = await ctx.db
        .query("workflowDispatches")
        .withIndex("by_instanceId", (q) => q.eq("instanceId", instanceId))
        .take(10);
      for (const row of rows) {
        if (row.state === "sent") {
          await ctx.db.patch("workflowDispatches", row._id, {
            lastReconciledAt: now,
          });
        }
      }
    }
    return null;
  },
});

const HEALTH_SCAN_LIMIT = 500;
const HEALTH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// A due row this old means no flush is taking rows: the watchdog reports
// it, and both the watchdog and `pruneFinished` re-arm a flush.
const PENDING_STALL_MS = 15 * 60 * 1000;
// The reconcile runs hourly, so a stale run it hasn't looked at for this
// long means the Core Worker stopped reconciling.
const RECONCILE_GRACE_MS = 2 * 60 * 60 * 1000;

export const dispatchHealthValidator = v.object({
  pending: v.number(),
  oldestDueAt: v.union(v.number(), v.null()),
  stalledPending: v.number(),
  sent: v.number(),
  oldestSentAt: v.union(v.number(), v.null()),
  unreconciledSent: v.number(),
  failedLastWeek: v.number(),
  latestFailures: v.array(
    v.object({
      error: v.union(v.string(), v.null()),
      finishedAt: v.number(),
      kind: v.string(),
    })
  ),
  isApproximate: v.boolean(),
});

export const readDispatchHealth = async (
  ctx: QueryCtx,
  now: number
): Promise<typeof dispatchHealthValidator.type> => {
  const pending = await ctx.db
    .query("workflowDispatches")
    .withIndex("by_state_and_notBefore", (q) => q.eq("state", "pending"))
    .take(HEALTH_SCAN_LIMIT);
  const sent = await ctx.db
    .query("workflowDispatches")
    .withIndex("by_state_and_sentAt", (q) => q.eq("state", "sent"))
    .take(HEALTH_SCAN_LIMIT);
  const failed = await ctx.db
    .query("workflowDispatches")
    .withIndex("by_state_and_finishedAt", (q) =>
      q.eq("state", "failed").gte("finishedAt", now - HEALTH_WINDOW_MS)
    )
    .order("desc")
    .take(HEALTH_SCAN_LIMIT);
  const firstDue = pending[0]?.notBefore;
  return {
    pending: pending.length,
    oldestDueAt: firstDue !== undefined && firstDue <= now ? firstDue : null,
    stalledPending: pending.filter(
      (row) => row.notBefore < now - PENDING_STALL_MS
    ).length,
    sent: sent.length,
    oldestSentAt: sent[0]?.sentAt ?? null,
    unreconciledSent: sent.filter(
      (row) =>
        isStale(row, now - RECONCILE_GRACE_MS) &&
        !((row.lastReconciledAt ?? 0) >= now - RECONCILE_GRACE_MS)
    ).length,
    failedLastWeek: failed.length,
    latestFailures: failed.slice(0, 5).map((row) => ({
      error: row.error ?? null,
      finishedAt: row.finishedAt ?? 0,
      kind: row.kind,
    })),
    isApproximate: [pending, sent, failed].some(
      (rows) => rows.length === HEALTH_SCAN_LIMIT
    ),
  };
};

export const dispatchHealth = internalQuery({
  args: {},
  returns: dispatchHealthValidator,
  handler: (ctx) => readDispatchHealth(ctx, Date.now()),
});

export const pruneFinished = internalMutation({
  args: {},
  returns: v.object({
    deleted: v.number(),
    hasMore: v.boolean(),
    stuckPending: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const stuck = await ctx.db
      .query("workflowDispatches")
      .withIndex("by_state_and_notBefore", (q) =>
        q.eq("state", "pending").lt("notBefore", now - PENDING_STALL_MS)
      )
      .take(100);
    if (stuck.length > 0) {
      await scheduleFlush(ctx);
    }
    const sentDeletes = await ctx.db
      .query("workflowDispatches")
      .withIndex("by_kind_and_state_and_sentAt", (q) =>
        q
          .eq("kind", "deleteObjects")
          .eq("state", "sent")
          .lt("sentAt", now - objectDeletionDispatch.deliveredAfterMs)
      )
      .take(200);
    for (const row of sentDeletes) {
      await ctx.db.patch("workflowDispatches", row._id, {
        finishedAt: now,
        state: "done",
      });
    }
    let deleted = 0;
    let hasMore = false;
    for (const state of ["done", "failed"] as const) {
      const rows = await ctx.db
        .query("workflowDispatches")
        .withIndex("by_state_and_finishedAt", (q) =>
          q.eq("state", state).lt("finishedAt", now - DISPATCH_RETENTION_MS)
        )
        .take(200);
      for (const row of rows) {
        await ctx.db.delete("workflowDispatches", row._id);
      }
      deleted += rows.length;
      hasMore ||= rows.length === 200;
    }
    return { deleted, hasMore, stuckPending: stuck.length };
  },
});
