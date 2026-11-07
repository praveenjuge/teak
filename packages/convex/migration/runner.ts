import type { FunctionReference, PaginationResult } from "convex/server";
import { type GenericValidator, v } from "convex/values";
import type { MutationCtx } from "../_generated/server";

/**
 * The loop every backfill shares: read one page, let the backfill look at
 * its rows, add up what it found, and schedule the next page until the
 * table is done. `dryRun` defaults to true, `once` stops after one page,
 * and the totals ride along to the last page, which logs them.
 */

export type BackfillTotals = Record<string, number>;

export const backfillArgs = <Totals extends GenericValidator>(
  totals: Totals
) => ({
  cursor: v.optional(v.union(v.string(), v.null())),
  dryRun: v.optional(v.boolean()),
  batchSize: v.optional(v.number()),
  once: v.optional(v.boolean()),
  totals: v.optional(totals),
});

export const backfillReturns = <Totals extends GenericValidator>(
  totals: Totals
) =>
  v.object({
    dryRun: v.boolean(),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
    continuationScheduled: v.boolean(),
    batch: totals,
    totals,
  });

export interface BackfillArgs<Totals> {
  batchSize?: number;
  cursor?: string | null;
  dryRun?: boolean;
  once?: boolean;
  totals?: Totals;
}

export interface BackfillPage<Row, Totals> {
  /** Adds a page's counts to the totals so far; numbers add by default. */
  add?: (previous: Totals, batch: Totals) => Totals;
  batchSize?: { default: number; max: number };
  /** Counts before the first row. */
  empty: () => Totals;
  /** Runs once after the last page, with the final totals. */
  finish?: (dryRun: boolean, totals: Totals) => Promise<void>;
  /** The name the finished log uses. */
  name: string;
  /** How long the next page waits; it starts at once by default. */
  nextPageDelayMs?: (batch: Totals, dryRun: boolean) => number;
  read: (
    cursor: string | null,
    numItems: number
  ) => Promise<PaginationResult<Row>>;
  /** The mutation itself, scheduled for the next page. */
  self: FunctionReference<"mutation", "internal">;
  /**
   * Looks at one page, counting into `batch` and writing only when it isn't
   * a dry run. What it returns rides along to the next page's arguments.
   */
  visit: (
    rows: Row[],
    batch: Totals,
    dryRun: boolean
  ) => Promise<Record<string, unknown> | undefined>;
}

const addNumbers = <Totals>(previous: Totals, batch: Totals): Totals =>
  Object.fromEntries(
    Object.entries(batch as Record<string, unknown>).map(([key, value]) => [
      key,
      typeof value === "number"
        ? ((previous as Record<string, number>)[key] ?? 0) + value
        : value,
    ])
  ) as Totals;

export const runBackfillPage = async <Row, Totals>(
  ctx: MutationCtx,
  args: BackfillArgs<Totals>,
  page: BackfillPage<Row, Totals>
) => {
  const dryRun = args.dryRun ?? true;
  const { default: fallback, max } = page.batchSize ?? {
    default: 100,
    max: 200,
  };
  const batchSize = Math.min(
    max,
    Math.max(1, Math.floor(args.batchSize ?? fallback))
  );
  const result = await page.read(args.cursor ?? null, batchSize);
  const batch = page.empty();
  const carry = (await page.visit(result.page, batch, dryRun)) ?? {};
  const totals = (page.add ?? addNumbers)(args.totals ?? page.empty(), batch);
  const isDone = result.isDone;
  const continuationScheduled = !(isDone || args.once);
  if (continuationScheduled) {
    await ctx.scheduler.runAfter(
      page.nextPageDelayMs?.(batch, dryRun) ?? 0,
      page.self,
      { cursor: result.continueCursor, dryRun, batchSize, totals, ...carry }
    );
  } else if (isDone) {
    await page.finish?.(dryRun, totals);
    console.log(`${page.name} finished`, { dryRun, ...totals });
  }
  return {
    dryRun,
    isDone,
    continueCursor: isDone ? null : result.continueCursor,
    continuationScheduled,
    batch,
    totals,
  };
};
