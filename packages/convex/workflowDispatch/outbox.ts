import type { AnalyticsEventItem, WorkflowName } from "@teak/files-protocol";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  DISPATCH_PARAMS,
  type DispatchKind,
  type DispatchParams,
} from "../schema/validators/dispatch";

/**
 * The write side of the workflow dispatch outbox. Domains queue their rows
 * here and declare how their kind is sent and settled (`DispatchKindSpec`);
 * `workflowDispatch.ts` hands due rows to the Core Worker. This module
 * imports no domain code, so any domain can queue work without depending on
 * every other domain the dispatcher settles.
 */

export type {
  DispatchKind,
  DispatchParams,
} from "../schema/validators/dispatch";

/** A dispatch row whose `params` are the ones its `kind` carries. */
export type DispatchRow<Kind extends DispatchKind> = Omit<
  Doc<"workflowDispatches">,
  "kind" | "params"
> & {
  kind: Kind;
  params: DispatchParams<Kind>;
};

/**
 * How the dispatcher sends and settles one kind of row. Every kind in
 * `DISPATCH_PARAMS` has exactly one, kept beside its domain code.
 */
export type DispatchKindSpec<Kind extends DispatchKind> = {
  /** A run that died, or a dispatch that gave up. */
  onFailure?: (
    ctx: MutationCtx,
    row: DispatchRow<Kind>,
    error: string
  ) => Promise<void>;
  /**
   * How long a sent row may stay silent before the Core Worker's reconcile
   * looks it up (or, for object deletions, before it counts as delivered).
   * Absent for rows that are gone once claimed.
   */
  staleAfterMs?: number;
} & (
  | {
      delivery: "workflow";
      /** Whatever ran, once the Worker reports the instance finished. */
      onRunEnded?: (
        ctx: MutationCtx,
        row: DispatchRow<Kind>,
        status: "complete" | "errored"
      ) => Promise<void>;
      /**
       * Runs when the row comes due, before it is sent: `skip` settles a
       * row that no longer needs its run, and `terminate` names the
       * instances the new run replaces.
       */
      prepare?: (
        ctx: MutationCtx,
        row: DispatchRow<Kind>
      ) => Promise<{ skip: string } | { terminate: string[] }>;
      workflow: WorkflowName;
    }
  | { delivery: "delete-objects" }
  | { delivery: "analytics-event" }
);

export type DispatchKindSpecs = {
  readonly [Kind in DispatchKind]: DispatchKindSpec<Kind>;
};

type AnyDispatchRow = {
  [Kind in DispatchKind]: DispatchRow<Kind>;
}[DispatchKind];

/**
 * Reads a stored row as its kind's row. Rows are written through
 * `insertDispatch`, which takes the params of the kind it writes, so a
 * row's kind says what its params are. A row without the params its kind
 * carries (one written by hand) is null: it is settled without its kind's
 * handlers.
 */
export const asDispatchRow = (
  row: Doc<"workflowDispatches">
): AnyDispatchRow | null =>
  row.params === undefined && DISPATCH_PARAMS[row.kind] !== null
    ? null
    : (row as unknown as AnyDispatchRow);

// Keys a deletion gave up on are queued again this much later, so a Worker
// outage longer than the retries delays a deletion instead of leaking it.
export const DEAD_LETTER_RETRY_MS = 24 * 60 * 60 * 1000;

// Every save schedules its own flush, so under parallel saves many flushes
// call claim at the same moment and conflict with each other on the due
// range. Convex retries those conflicts internally; the guards in
// `workflowDispatch.ts` keep that cheap: a small jitter spreads claim starts
// out, claim reads only a small page per mutation so conflicting
// transactions stay short, and a flush whose claim still exhausts Convex's
// retries reschedules itself with backoff instead of dying.
export const FLUSH_JITTER_MS = 1500;

/**
 * Transactions that already scheduled an immediate flush. Convex gives each
 * mutation run its own `ctx.db`, so an entry covers only the transaction in
 * hand: its later rows (analytics events, more deletion batches) ride on
 * the one flush, and the entry goes with the transaction.
 */
const flushScheduled = new WeakSet<object>();

// crypto.getRandomValues instead of Math.random: static analysis flags
// Math.random as a weak RNG even for scheduling jitter.
const randomBelow = (bound: number): number => {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return (buffer[0] ?? 0) % bound;
};

export const scheduleFlush = async (ctx: MutationCtx, delayMs = 0) => {
  if (delayMs === 0 && flushScheduled.has(ctx.db)) {
    return;
  }
  if (delayMs === 0) {
    flushScheduled.add(ctx.db);
  }
  const jitter = delayMs === 0 ? randomBelow(FLUSH_JITTER_MS) : 0;
  await ctx.scheduler.runAfter(
    delayMs + jitter,
    internal.workflowDispatch.flush,
    {}
  );
};

type NewDispatch<Kind extends DispatchKind> = {
  delayMs?: number;
  kind: Kind;
} & (DispatchParams<Kind> extends undefined
  ? { params?: undefined }
  : { params: DispatchParams<Kind> }) &
  Omit<
    Doc<"workflowDispatches">,
    | "_creationTime"
    | "_id"
    | "createdAt"
    | "kind"
    | "notBefore"
    | "params"
    | "state"
  >;

export const insertDispatch = async <Kind extends DispatchKind>(
  ctx: MutationCtx,
  row: NewDispatch<Kind>
): Promise<Id<"workflowDispatches">> => {
  const { delayMs = 0, ...fields } = row;
  const now = Date.now();
  const id = await ctx.db.insert("workflowDispatches", {
    // A generic kind's params can't be narrowed to the stored union, but
    // NewDispatch<Kind> already pairs them with their kind.
    ...(fields as Omit<
      Doc<"workflowDispatches">,
      "_creationTime" | "_id" | "createdAt" | "notBefore" | "state"
    >),
    createdAt: now,
    notBefore: now + delayMs,
    state: "pending",
  });
  // Every row schedules its own flush rather than checking whether one is
  // already coming: that check read the due range every concurrent save
  // writes into, so parallel saves conflicted on it until one exhausted its
  // OCC retries and the request failed. Duplicate flushes instead conflict
  // with each other in claim, and the jitter in scheduleFlush, claim's small
  // page and the flush's own claim retry keep those conflicts cheap next to
  // a failed save.
  await scheduleFlush(ctx, delayMs);
  return id;
};

/**
 * Queues one backend analytics event for the Core Worker to send to
 * PostHog. Its flush is the one this transaction already scheduled, if any,
 * so an event costs no function call of its own.
 */
export const queueAnalyticsEvent = async (
  ctx: MutationCtx,
  event: Omit<AnalyticsEventItem, "type">
): Promise<void> => {
  await insertDispatch(ctx, {
    key: "analytics",
    kind: "analyticsEvent",
    params: event,
  });
};

// Best effort, like an event an action sends itself: the row goes when it
// is handed over, so delivery needs no second write.
export const analyticsEventDispatch: DispatchKindSpec<"analyticsEvent"> = {
  delivery: "analytics-event",
};

export const queueMaintenanceWorkflow = async (
  ctx: MutationCtx,
  instanceId: string,
  params: Omit<DispatchParams<"maintenance">, "dispatched">
): Promise<string> => {
  await insertDispatch(ctx, {
    instanceId,
    key: `maintenance:${params.task}`,
    kind: "maintenance",
    params: { ...params, dispatched: true },
  });
  return instanceId;
};

// A maintenance run reports through its cron's heartbeat, so a failed one
// needs nothing here.
export const maintenanceDispatch: DispatchKindSpec<"maintenance"> = {
  delivery: "workflow",
  staleAfterMs: 6 * 60 * 60 * 1000,
  workflow: "maintenance",
};
