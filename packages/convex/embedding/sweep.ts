import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";

/**
 * Weekly report-only check of the `cardEmbeddings` ledger. Every vector is
 * written after its row and its row is removed only after the vector is
 * deleted, so every vector the index could hold wrongly shows up here as a
 * row. It never deletes or queues anything: the counts tell an operator
 * whether to look closer or run the backfill.
 */

const PAGE_SIZE = 500;
/** Hard cap so a pathological ledger cannot spin the cron forever. */
const MAX_PAGES = 2000;
/** A vector delete still pending after this has failed for good. */
const STALE_TOMBSTONE_MS = 24 * 60 * 60 * 1000;
/** An embed due this long ago has lost its job. */
const LOST_JOB_MS = 60 * 60 * 1000;
const SAMPLE_SIZE = 10;

const countsValidator = v.object({
  rows: v.number(),
  /** Vector deletes that kept failing: the vector is still in the index. */
  staleTombstones: v.number(),
  /** Rows of cards that are gone and were never tombstoned. */
  cardMissing: v.number(),
  /** Embeds that ran out of retries. */
  failedEmbeds: v.number(),
  /** Embeds due long ago with no job left to run them. */
  lostJobs: v.number(),
});

type Counts = typeof countsValidator.type;

export const sweepPage = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    now: v.number(),
  },
  returns: v.object({
    counts: countsValidator,
    samples: v.array(v.id("cards")),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor, now }) => {
    const page = await ctx.db
      .query("cardEmbeddings")
      .paginate({ cursor, numItems: PAGE_SIZE });
    const counts: Counts = {
      rows: 0,
      staleTombstones: 0,
      cardMissing: 0,
      failedEmbeds: 0,
      lostJobs: 0,
    };
    const samples: Id<"cards">[] = [];
    for (const row of page.page) {
      counts.rows += 1;
      let problem = true;
      if (row.pendingVectorDeleteAt !== undefined) {
        problem = row.pendingVectorDeleteAt < now - STALE_TOMBSTONE_MS;
        counts.staleTombstones += problem ? 1 : 0;
      } else if (!(await ctx.db.get("cards", row.cardId))) {
        counts.cardMissing += 1;
      } else if (row.dueAt !== undefined) {
        problem = row.dueAt < now - LOST_JOB_MS;
        counts.lostJobs += problem ? 1 : 0;
      } else if (row.lastError !== undefined && row.hash === undefined) {
        counts.failedEmbeds += 1;
      } else {
        problem = false;
      }
      if (problem && samples.length < SAMPLE_SIZE) {
        samples.push(row.cardId);
      }
    }
    return {
      counts,
      samples,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const sweepVectorLedger = internalAction({
  args: {},
  returns: countsValidator,
  handler: async (ctx) => {
    const now = Date.now();
    const totals: Counts = {
      rows: 0,
      staleTombstones: 0,
      cardMissing: 0,
      failedEmbeds: 0,
      lostJobs: 0,
    };
    const samples: string[] = [];
    let cursor: string | null = null;
    for (let pages = 0; pages < MAX_PAGES; pages += 1) {
      const page: {
        counts: Counts;
        samples: string[];
        continueCursor: string;
        isDone: boolean;
      } = await ctx.runQuery(internal.embedding.sweep.sweepPage, {
        cursor,
        now,
      });
      for (const key of Object.keys(totals) as (keyof Counts)[]) {
        totals[key] += page.counts[key];
      }
      samples.push(...page.samples.slice(0, SAMPLE_SIZE - samples.length));
      if (page.isDone) {
        break;
      }
      cursor = page.continueCursor;
    }
    const problems = sumProblems(totals);
    // Durable, dashboard-visible log of every sweep. Card ids only.
    console.log(
      "[embedding/sweep]",
      problems > 0
        ? "vectors.ledger_problems_detected"
        : "vectors.ledger_clean",
      { ...totals, samples }
    );
    return totals;
  },
});

const sumProblems = (counts: Counts) =>
  counts.staleTombstones +
  counts.cardMissing +
  counts.failedEmbeds +
  counts.lostJobs;
